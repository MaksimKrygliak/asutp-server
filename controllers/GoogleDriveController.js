// controllers/GoogleDriveController.js
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import util from "util";
import { getDriveClient, authorizeOnce } from "../utils/driveService.js";
import NodeCache from "node-cache";

const driveCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });

const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);
const pbkdf2Async = util.promisify(crypto.pbkdf2);
const ROOT_FOLDER_ID = "root";

const tmpFilePath = (prefix = "tmp") => {
  const name = `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  return path.join(os.tmpdir(), name);
};
async function ensureFolderPath(drive, parentId, folders = []) {
  let currentParent = parentId;

  for (const folderName of folders) {
    // ищем папку с таким именем под текущим родителем
    const resp = await drive.files.list({
      q: `'${currentParent}' in parents and name = '${escapeQuery(
        folderName
      )}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id, name)",
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    if (resp.data.files && resp.data.files.length > 0) {
      currentParent = resp.data.files[0].id;
      continue;
    }

    // создаём папку
    const createResp = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [currentParent],
      },
      fields: "id, name",
      supportsAllDrives: true,
    });

    currentParent = createResp.data.id;
  }

  return currentParent;
}

function escapeQuery(s) {
  return String(s).replace(/'/g, "\\'");
}

export async function getDriveContent(req, res) {
  try {
    const { drive } = await getDriveClient();

    const parentId = req.query.parentId;

    const response = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, size, modifiedTime, parents)",
      pageSize: 1000,
      orderBy: "folder,name",
    });

    const files = response.data.files || [];

    return res.json({
      success: true,
      parentId,
      count: files.length,
      files,
    });
  } catch (error) {
    console.error("❌ Ошибка при получении содержимого Google Drive:", error);
    return res.status(500).json({
      success: false,
      message: "Не удалось получить список файлов с Google Drive",
      error: error?.message || String(error),
    });
  }
}

export async function downloadDocument(req, res) {
  const fileId = req.params.id;
  if (!fileId) return res.status(400).send("Не указан fileId");

  try {
    const { drive } = await getDriveClient(); // Корректная деструктуризация // Получаем метаданные, чтобы знать имя/тип/size // ... (остальной код получения метаданных и установки заголовков)

    const meta = await drive.files.get({
      fileId,
      fields: "id, name, mimeType, size",
      supportsAllDrives: true,
    });

    const fileName = meta.data.name || "download.bin";
    const mimeType = meta.data.mimeType || "application/octet-stream";

    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    res.setHeader("Content-Type", mimeType);
    if (meta.data.size) {
      res.setHeader("Content-Length", meta.data.size);
    } // Запрашиваем контент файла в виде потока (stream)

    const driveRes = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "stream" }
    ); // Перенаправляем поток данных с Google Drive в ответ Express

    driveRes.data.pipe(res); // ... (обработка end/error)
    driveRes.data.on("error", (err) => {
      console.error("Stream error:", err);
      try {
        // Если заголовки уже отправлены, просто завершаем ответ.
        // Иначе отправляем 500.
        if (!res.headersSent) res.status(500).end("Ошибка потока данных.");
        res.end();
      } catch {}
    });
  } catch (err) {
    console.error("❌ downloadDocument error:", err); // Если произошла ошибка до отправки заголовков (например, при получении токена), // отправляем статус ошибки
    if (!res.headersSent) {
      return res.status(500).send("Ошибка при скачивании файла.");
    }
  }
}

export async function encryptAndUploadDocument(req, res) {
  try {
    const { fileId, relativePath, password, encryptedRootId } = req.body;

    if (!fileId || !relativePath || !password) {
      return res.status(400).json({
        success: false,
        message: "Нужны fileId, relativePath и password в теле запроса (JSON).",
      });
    }

    const { drive } = await getDriveClient(); // временные файлы

    const tmpIn = tmpFilePath("decrypted");
    const tmpOut = tmpFilePath("encrypted"); // 1) скачиваем файл (Оставляем как есть - потоковая запись)

    await new Promise(async (resolve, reject) => {
      try {
        const r = await drive.files.get(
          { fileId, alt: "media", supportsAllDrives: true },
          { responseType: "stream" }
        );
        const out = fs.createWriteStream(tmpIn);
        r.data.pipe(out);
        r.data.on("end", () => resolve());
        r.data.on("error", (e) => reject(e));
      } catch (e) {
        reject(e);
      }
    }); // 2) шифруем (AES-256-CBC)

    try {
      await encryptFileRNCompatible(tmpIn, tmpOut, password, true);
    } catch (e) {
      console.error("Ошибка при RN-совместимом шифровании:", e);
      throw new Error("Encryption failed");
    } // 3) определяем папку для загрузки

    let parentFolderId = encryptedRootId;

    const relFolders = path
      .dirname(relativePath)
      .split(path.sep)
      .filter(Boolean)
      .filter((f) => f !== ".");

    if (relFolders.length > 0) {
      parentFolderId = await ensureFolderPath(
        drive,
        encryptedRootId,
        relFolders
      );
    } // Переименование

    const base = path.basename(relativePath);
    const encryptedName = base.replace(/\.[^/.]+$/, "") + ".encrypted"; // ========================================================== // ⭐ ШАГ 4: ПРОВЕРКА НАЛИЧИЯ И ПЕРЕЗАПИСЬ (ОБНОВЛЕНИЕ ЛОГИКИ) ⭐ // ========================================================== // Ищем существующий файл с таким же именем в целевой папке

    const existingFileSearch = await drive.files.list({
      q: `'${parentFolderId}' in parents and name = '${escapeQuery(
        encryptedName
      )}' and trashed = false`,
      fields: "files(id)",
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const existingFileId =
      existingFileSearch.data.files && existingFileSearch.data.files.length > 0
        ? existingFileSearch.data.files[0].id
        : null; // 5) upload / update

    const media = {
      mimeType: "application/octet-stream",
      body: fs.createReadStream(tmpOut),
    };

    let uploadResp;
    if (existingFileId) {
      // Если файл существует, обновляем его (перезаписываем контент)
      uploadResp = await drive.files.update(
        {
          fileId: existingFileId,
          media,
          fields: "id, name, parents",
          supportsAllDrives: true,
        },
        {}
      );
    } else {
      // Если файл не существует, создаем новый
      uploadResp = await drive.files.create(
        {
          requestBody: {
            name: encryptedName,
            parents: [parentFolderId],
          },
          media,
          fields: "id, name, parents",
          supportsAllDrives: true,
        },
        {}
      );
    } // cleanup
    // ==========================================================

    try {
      fs.unlinkSync(tmpIn);
    } catch {}
    try {
      fs.unlinkSync(tmpOut);
    } catch {}

    return res.json({
      success: true,
      uploaded: uploadResp.data,
    });
  } catch (err) {
    console.error("❌ Ошибка при шифровании и загрузке:", err);
    return res.status(500).json({
      success: false,
      message:
        "Ошибка сервера: не удалось завершить процесс шифрования/загрузки.",
      error: err?.message || String(err),
    });
  }
}

export async function generatePBKDF2KeyBuffer(password, salt) {
  const derived = await pbkdf2Async(password, salt, 5000, 32, "sha512");
  const derivedHex = derived.toString("hex");
  return derived;
}

export async function encryptFileRNCompatible(
  inputPath,
  outputPath,
  password,
  isSingleFile = false
) {
  const fileDataBase64 = await readFileAsync(inputPath, { encoding: "base64" });
  const salt = "single_file_salt";

  const keyBuffer = await generatePBKDF2KeyBuffer(password, salt);

  const ivBuffer = crypto.randomBytes(16);
  const ivHex = ivBuffer.toString("hex");

  const cipher = crypto.createCipheriv("aes-256-cbc", keyBuffer, ivBuffer);
  let encrypted = cipher.update(fileDataBase64);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const encryptedBase64 = encrypted.toString("base64");

  const encryptedContent = JSON.stringify({
    encrypted: encryptedBase64,
    iv: ivHex,
    salt: salt,
  });

  await writeFileAsync(outputPath, encryptedContent, "utf8");
}

export async function downloadDocumentByPath(req, res) {
  try {
    const { folderName, fileName } = req.query;

    if (!folderName || !fileName) {
      return res.status(400).send("Не указаны folderName или fileName");
    }

    const ROOT_FOLDER_ID =
      process.env.DRIVE_ROOT_ID_ENCRYPTED ||
      "1kAs_hnvLQY6sfwhnkSuHFA-eaGPP57e9";
    const { drive } = await getDriveClient();

    // 🔥 2. СОЗДАЕМ УНИКАЛЬНЫЙ КЛЮЧ ДЛЯ КЭША
    const cacheKey = `file_${folderName}_${fileName}`;

    // Пробуем достать ID файла и его размер из памяти
    let fileMeta = driveCache.get(cacheKey);

    // Если в кэше пусто (Cache Miss), идем искать в Google Drive
    if (!fileMeta) {
      console.log(
        `[Cache Miss] Ищем ${fileName} в папке ${folderName} через Google API...`
      );

      // 1. ИЩЕМ ПАПКУ В КОРНЕ
      const folderRes = await drive.files.list({
        q: `'${ROOT_FOLDER_ID}' in parents and name = '${escapeQuery(
          folderName
        )}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: "files(id)",
        pageSize: 1,
        supportsAllDrives: true,
      });

      if (!folderRes.data.files || folderRes.data.files.length === 0) {
        return res.status(404).send("Папка не найдена");
      }
      const targetFolderId = folderRes.data.files[0].id;

      // 2. ИЩЕМ ФАЙЛ ВНУТРИ ПАПКИ
      const fileRes = await drive.files.list({
        q: `'${targetFolderId}' in parents and name = '${escapeQuery(
          fileName
        )}' and trashed = false`,
        fields: "files(id, name, mimeType, size)",
        pageSize: 1,
        supportsAllDrives: true,
      });

      if (!fileRes.data.files || fileRes.data.files.length === 0) {
        return res.status(404).send("Файл не найден");
      }

      const targetFile = fileRes.data.files[0];

      // Сохраняем нужные метаданные для скачивания
      fileMeta = {
        id: targetFile.id,
        name: targetFile.name,
        mimeType: targetFile.mimeType,
        size: targetFile.size,
      };

      // 🔥 3. ЗАПИСЫВАЕМ В КЭШ
      driveCache.set(cacheKey, fileMeta);
    } else {
      console.log(
        `[Cache Hit] Файл ${fileName} найден в памяти сервера! Скорость +100%`
      );
    }

    // 4. ОТДАЕМ ФАЙЛ (ПОТОКОВАЯ ПЕРЕДАЧА ПО ID)
    // Теперь мы используем fileMeta (взятый либо из кэша, либо из свежего ответа Google)
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(fileMeta.name)}`
    );
    res.setHeader(
      "Content-Type",
      fileMeta.mimeType || "application/octet-stream"
    );
    if (fileMeta.size) {
      res.setHeader("Content-Length", fileMeta.size);
    }

    const driveRes = await drive.files.get(
      { fileId: fileMeta.id, alt: "media", supportsAllDrives: true },
      { responseType: "stream" }
    );

    driveRes.data.pipe(res);

    driveRes.data.on("error", (err) => {
      console.error("Stream error during downloadByPath:", err);
      if (!res.headersSent) res.status(500).end("Ошибка потока данных.");
    });
  } catch (err) {
    console.error("❌ Ошибка в downloadDocumentByPath:", err);
    if (!res.headersSent) {
      res.status(500).send("Ошибка сервера при поиске и скачивании файла.");
    }
  }
}

import { google } from "googleapis";
import path from "path";
import { fileURLToPath } from "url";

// --- ОПРЕДЕЛЕНИЕ __dirname В СРЕДЕ ES MODULES ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// --------------------------------------------------

// --- КОНФИГУРАЦИЯ СЕРВИСНОГО АККАУНТА ---
// Теперь __dirname определен и используется для построения пути
const KEY_FILE_PATH = path.join(__dirname, "service-account-key.json");
// SCOPE: Разрешения, которые вы дали аккаунту (только для чтения)
const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

// ID корневой папки, файлы из которой вы хотите отобразить
// Замените на фактический ID папки!
const TARGET_FOLDER_ID = "ВАШ_ID_СЛУЖЕБНОЙ_ПАПКИ";
// ------------------------------------------

// Инициализация аутентификации Сервисного Аккаунта
const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE_PATH,
  scopes: SCOPES,
});

// Получение экземпляра Google Drive API
const drive = google.drive({ version: "v3", auth });

export const getDriveContent = async (req, res) => {
  console.log("111");
  try {
    const response = await drive.files.list({
      // Ищем элементы, которые находятся в TARGET_FOLDER_ID И не удалены.
      q: `'${TARGET_FOLDER_ID}' in parents and trashed = false`, // Поля, которые мы хотим получить для каждого элемента

      fields: "files(id, name, mimeType, size, webViewLink)", // Сортировка: сначала папки, потом файлы, по имени

      orderBy: "folder,name", // Максимальное количество результатов

      pageSize: 100,
    });

    const items = response.data.files || []; // Форматирование данных для клиента React Native

    const formattedContent = items.map((item) => ({
      id: item.id,
      name: item.name,
      isFolder: item.mimeType === "application/vnd.google-apps.folder",
      mimeType: item.mimeType,
      size: item.size, // Размер будет отсутствовать для папок
      webViewLink: item.webViewLink, // Ссылка для просмотра в браузере // Ссылка для скачивания (нужна для прямого скачивания на клиенте)
      downloadLink:
        item.mimeType !== "application/vnd.google-apps.folder"
          ? `https://www.googleapis.com/drive/v3/files/${item.id}?alt=media`
          : null,
    })); // Возвращаем клиенту очищенный и структурированный список

    res.json({ files: formattedContent });
  } catch (error) {
    console.error("SERVER_DRIVE_ERROR:", error.message); // 500 Internal Server Error
    res.status(500).json({
      message: "Не удалось получить данные с Google Диска.",
      details: error.message,
    });
  }
};

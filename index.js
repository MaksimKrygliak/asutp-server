import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import {
  registerValidation,
  loginValidation,
  postCreateValidation,
} from "./validations.js";
import { handleValidationErrors, checkAuth } from "./utils/index.js";
import {
  authController,
  UserController,
  PostController,
  DocController,
  PhoneNumberController,
  SectionController,
  PremiseController,
  EnclosureItemController,
  ComputersController,
  ServerController,
  UPSController,
  VirtualMachineController,
  TerminalblocksController,
  СhannelController,
  GoogleDriveController,
} from "./controllers/index.js";
import { verifyAdminRole } from "./utils/verifyRole.js";
import { v2 as cloudinary } from "cloudinary";
import fileUpload from "express-fileupload";
import {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  ALL_ROLES,
} from "./utils/permissions.js";
import { authorizeOnce, getAuthUrl } from "./utils/driveService.js";
import {
  sendPushNotification,
  sendMulticastPush,
} from "./utils/notificationService.js";
import UserModel from "./models/User.js";
import sendMessage from "./utils/sendMessage.js";

const mongoUri = process.env.MONGODB_URI;
const cloud_name = process.env.CLOUD_NAME;
const api_key = process.env.API_KEY;
const api_secret = process.env.API_SECRET;
const latest_app_version = process.env.LATEST_APP_VERSION;
const force_update_min_version = process.env.FORCE_UPDATE_MIN_VERSION;
const update_url_android = process.env.UPDATE_URL_ANDROID;
const DOCUMENTS_ZIP_DOWNLOAD_URL = process.env.DOCUMENTS_ZIP_DOWNLOAD_URL;
 
mongoose
  .connect(
    mongoUri
  )
  .then(() => console.log("DB ok"))
  .catch((err) => console.log("DB error", err));

const app = express();

app.use(express.json());
app.use(cors());
app.use(
  fileUpload({
    useTempFiles: true,
    tempFileDir: "/tmp/",
    createParentPath: true,
  })
);

cloudinary.config({
  cloud_name: cloud_name || "dhjnmoauc",
  api_key: api_key || "218662455584231",
  api_secret: api_secret || "ykr5JYbYBDOZDFc82Zs2eLUwcFQ",
});

app.post(
  "/notifications/send-test",
  checkAuth,
  verifyAdminRole,
  async (req, res) => {
    try {
      const { userId, title, body, data = {} } = req.body;

      if (!userId || !title || !body) {
        return res
          .status(400)
          .json({ message: "Требуются userId, title и body." });
      }

      // 1. Находим пользователя и его FCM токен в базе данных
      const user = await UserModel.findById(userId).select("fcmToken");

      if (!user || !user.fcmToken) {
        return res
          .status(404)
          .json({ message: "Токен для указанного пользователя не найден." });
      }

      // 2. Отправляем уведомление
      const result = await sendPushNotification(
        user.fcmToken,
        title,
        body,
        data
      );

      if (result.success) {
        res.status(200).json({
          message: "Уведомление успешно отправлено.",
          messageId: result.messageId,
        });
      } else {
        res.status(500).json({
          message: "Ошибка при отправке уведомления.",
          error: result.error,
        });
      }
    } catch (error) {
      console.error("Ошибка в маршруте /notifications/send-test:", error);
      res.status(500).json({ message: "Внутренняя ошибка сервера." });
    }
  }
);

app.post(
  "/notifications/send-all",
  checkAuth, // 1. Проверяем, что запрос от авторизованного юзера
  verifyAdminRole, // 2. Проверяем, что это АДМИНИСТРАТОР
  async (req, res) => {
    try {
      const { title, body, data = {} } = req.body;

      if (!title || !body) {
        return res.status(400).json({ message: "Требуются title и body." });
      }

      // 1. Ищем всех пользователей, у которых есть FCM токен
      const usersWithTokens = await UserModel.find({
        fcmToken: { $exists: true, $ne: "" },
      }).select("fcmToken");

      const tokens = usersWithTokens.map((user) => user.fcmToken);

      if (tokens.length === 0) {
        return res
          .status(404)
          .json({ message: "Нет пользователей с доступными токенами." });
      }

      // 2. Делаем массовую рассылку
      const result = await sendMulticastPush(tokens, title, body, data);

      // 3. Очищаем базу от "мертвых" токенов (оптимизация БД)
      if (result.deadTokens.length > 0) {
        await UserModel.updateMany(
          { fcmToken: { $in: result.deadTokens } },
          { $unset: { fcmToken: 1 } }
        );
        console.log(
          `Удалено ${result.deadTokens.length} неактивных токенов из БД.`
        );
      }

      res.status(200).json({
        message: "Рассылка завершена",
        successCount: result.successCount,
        failureCount: result.failureCount,
      });
    } catch (error) {
      console.error("Ошибка в маршруте /notifications/send-all:", error);
      res.status(500).json({ message: "Внутренняя ошибка сервера." });
    }
  }
);

app.post("/images/delete", checkAuth, async (req, res) => {
  try {
    const { public_id } = req.body;

    if (!public_id) {
      return res.status(400).json({ error: "public_id is required" });
    }

    const result = await cloudinary.uploader.destroy(public_id);

    // Исправление: 'not found' - это тоже успех (файла же нет)
    if (result.result === "ok" || result.result === "not found") {
      res.json({ success: true, result: result.result });
    } else {
      res.status(400).json({ error: result.result });
    }
  } catch (e) {
    console.error("Cloudinary Delete Error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/newUpdate", checkAuth, async (req, res) => {
  try {
    const result = await sendMessage(
      "🔥 Доступна нова версія!",
      "Оновіть додаток, щоб отримати нові функції, можливості та виправлення.",
      {
        batchUpdate: "true",
      }
    );

    // 2. Возвращаем HTTP-ответ, основываясь на результате от sendMessage
    if (result.success) {
      // Успешная инициализация рассылки
      return res.status(200).json({
        message: result.message,
        totalTokens: result.totalTokens,
      });
    } else {
      const statusCode = result.totalTokens > 0 ? 500 : 200;
      return res.status(statusCode).json({
        message: result.message,
        error: true,
      });
    }
  } catch (error) {
    console.error("Критическая ошибка в маршруте /newUpdate:", error);
    return res.status(500).json({
      message: "Внутренняя ошибка сервера при запуске рассылки.",
      error: error.message,
    });
  }
});

app.get("/ping", (req, res) => {
  try {
    res.status(200).json({
      message: "Сервер доступен",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Ошибка при проверке связи:", error);
    res.status(500).json({
      message: "Внутренняя ошибка сервера при проверке связи",
      error: error.message,
    });
  }
});

app.get("/app_config", (req, res) => {
  try {
    const config = {
      latest_app_version: latest_app_version,
      force_update_min_version: force_update_min_version,
      update_url_android: update_url_android,
      documents_zip_download_url: DOCUMENTS_ZIP_DOWNLOAD_URL,
    };

    res.json(config);
  } catch (error) {
    console.error("Error fetching app config:", error);
    res.status(500).json({ message: "Failed to retrieve app configuration." });
  }
});

app.post(
  "/auth/login",
  loginValidation,
  handleValidationErrors,
  UserController.login
);
app.post(
  "/auth/register",
  registerValidation,
  handleValidationErrors,
  UserController.register
);
app.post("/auth/microsoft", authController.auth);
app.get("/auth/verify/:token", UserController.verifyEmail);
app.get("/auth/me", checkAuth, UserController.getMe);

app.get("/users", checkAuth, UserController.getAllUsers);
app.get("/users/changes", checkAuth, UserController.getChanges);
app.get("/users/:id", checkAuth, UserController.getUserById);
app.patch("/users/handleClearSync", checkAuth, UserController.handleClearSync);
app.patch("/users/batch-update", checkAuth, UserController.batchUpdateUsers);
app.patch("/users/:id", UserController.updateUserPassword);
app.patch(
  "/users/:id/viewed-posts",
  checkAuth,
  UserController.updateViewedPosts
);
app.post("/users/upload/:id/avatar", checkAuth, UserController.photoProfile);
app.delete("/users/:id/avatar", checkAuth, UserController.deletePhotoProfile);

app.get("/permissions", checkAuth, async (req, res) => {
  res.json({
    allPermissions: ALL_PERMISSIONS,
    rolePermissions: ROLE_PERMISSIONS,
    allRoles: ALL_ROLES,
  });
});

// Маршрут для получения разрешений конкретного пользователя
app.get("/users/:id/permissions", checkAuth, async (req, res) => {
  try {
    // Проверка, что только администратор может просматривать чужие разрешения,
    // или пользователь может просматривать свои
    if (req.user.role !== "администратор" && req.user.id !== req.params.id) {
      return res.status(403).json({ message: "Доступ запрещен." });
    }

    const user = await UserModel.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "Пользователь не найден." });
    }
    res.json({ permissions: user.permissions || [] });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка сервера при получении разрешений пользователя.",
    });
  }
});

// Маршрут для обновления разрешений конкретного пользователя
app.patch("/users/:id/permissions", checkAuth, async (req, res) => {
  try {
    // Только администратор может менять разрешения других пользователей
    if (req.user.role !== "администратор") {
      return res
        .status(403)
        .json({ message: "Доступ запрещен. Требуются права администратора." });
    }

    const { permissions } = req.body;

    // Валидация: убедитесь, что присланные разрешения существуют в ALL_PERMISSIONS
    const validPermissions = ALL_PERMISSIONS.map((p) => p.name);
    const invalidPermissions = permissions.filter(
      (p) => !validPermissions.includes(p)
    );
    if (invalidPermissions.length > 0) {
      return res.status(400).json({
        message: `Неверные разрешения: ${invalidPermissions.join(", ")}`,
      });
    }

    const user = await UserModel.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "Пользователь не найден." });
    }

    user.permissions = permissions; // Обновляем массив разрешений
    user.updatedAt = new Date(); // Обновляем дату изменения
    await user.save();

    res.json({
      message: "Разрешения пользователя успешно обновлены.",
      permissions: user.permissions,
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Ошибка сервера при обновлении разрешений." });
  }
});
app.post(
  "/user/update_app_version",
  checkAuth,
  UserController.updateAppVersion
);
app.post("/user/update_push_token", checkAuth, UserController.updatePushToken);

app.get("/phoneNumbers", checkAuth, PhoneNumberController.getAll);
app.get("/phoneNumbers/:id", checkAuth, PhoneNumberController.getOne);
app.post("/phoneNumbers", checkAuth, PhoneNumberController.create);
app.delete("/phoneNumbers/:id", checkAuth, PhoneNumberController.remove);
app.patch("/phoneNumbers/:id", checkAuth, PhoneNumberController.update);

app.get("/posts/changes", checkAuth, PostController.getChanges);
app.post("/posts/batch-create", checkAuth, PostController.batchCreate);
app.post("/posts/batch-delete", checkAuth, PostController.batchDeletePosts);
app.patch("/posts/batch-update", checkAuth, PostController.batchUpdatePosts);

app.get("/docs/changes", checkAuth, DocController.getChanges);
app.post("/docs/batch-create", checkAuth, DocController.batchCreate);
app.post("/docs/batch-delete", checkAuth, DocController.batchDeleteDocs);
app.patch("/docs/batch-update", checkAuth, DocController.batchUpdate);

app.post("/sections/batch-create", checkAuth, SectionController.createBatch);
app.patch("/sections/batch-update", checkAuth, SectionController.updateBatch);
app.post("/sections/batch-delete", checkAuth, SectionController.deleteBatch);
app.get("/sections/changes", checkAuth, SectionController.getChanges);
app.get("/sections/full-tree/:id", checkAuth, SectionController.getSectionFullTree);

app.post("/premises/batch-create", checkAuth, PremiseController.createBatch);
app.patch("/premises/batch-update", checkAuth, PremiseController.updateBatch);
app.post("/premises/batch-delete", checkAuth, PremiseController.deleteBatch);
app.get("/premises/changes", checkAuth, PremiseController.getChanges);

app.post(
  "/enclosures/batch-create",
  checkAuth,
  EnclosureItemController.createBatch
);
app.patch(
  "/enclosures/batch-update",
  checkAuth,
  EnclosureItemController.updateBatch
);
app.post(
  "/enclosures/batch-delete",
  checkAuth,
  EnclosureItemController.deleteBatch
);
app.get("/enclosures/changes", checkAuth, EnclosureItemController.getChanges);

app.post("/computers/batch-create", checkAuth, ComputersController.createBatch);
app.patch(
  "/computers/batch-update",
  checkAuth,
  ComputersController.updateBatch
);
app.post("/computers/batch-delete", checkAuth, ComputersController.deleteBatch);
app.get("/computers/changes", checkAuth, ComputersController.getChanges);

app.post("/servers/batch-create", checkAuth, ServerController.createBatch);
app.patch("/servers/batch-update", checkAuth, ServerController.updateBatch);
app.post("/servers/batch-delete", checkAuth, ServerController.deleteBatch);
app.get("/servers/changes", checkAuth, ServerController.getChanges);

app.post("/ups/batch-create", checkAuth, UPSController.createBatch);
app.patch("/ups/batch-update", checkAuth, UPSController.updateBatch);
app.post("/ups/batch-delete", checkAuth, UPSController.deleteBatch);
app.get("/ups/changes", checkAuth, UPSController.getChanges);

app.post(
  "/virtualmachines/batch-create",
  checkAuth,
  VirtualMachineController.createBatch
);
app.patch(
  "/virtualmachines/batch-update",
  checkAuth,
  VirtualMachineController.updateBatch
);
app.post(
  "/virtualmachines/batch-delete",
  checkAuth,
  VirtualMachineController.deleteBatch
);
app.get(
  "/virtualmachines/changes",
  checkAuth,
  VirtualMachineController.getChanges
);

app.post(
  "/terminalblocks/batch-create",
  checkAuth,
  TerminalblocksController.createBatch
);
app.patch(
  "/terminalblocks/batch-update",
  checkAuth,
  TerminalblocksController.updateBatch
);
app.post(
  "/terminalblocks/batch-delete",
  checkAuth,
  TerminalblocksController.deleteBatch
);
app.get(
  "/terminalblocks/changes",
  checkAuth,
  TerminalblocksController.getChanges
);

app.post("/signals/batch-create", checkAuth, СhannelController.createBatch);
app.patch("/signals/batch-update", checkAuth, СhannelController.updateBatch);
app.post("/signals/batch-delete", checkAuth, СhannelController.deleteBatch);
app.get("/signals/changes", checkAuth, СhannelController.getChanges);

// Зашифровать и загрузить файл на Google Drive
app.post(
  "/googleDrive/encryptAndUpload",
  checkAuth,
  GoogleDriveController.encryptAndUploadDocument
);

// Проверка авторизации (удобно для клиента)
app.get("/googleDrive/isAuthorized", checkAuth, (req, res) => {
  try {
    const authorized = GoogleDriveController.isAuthorized();
    res.json({ authorized });
  } catch {
    res.json({ authorized: false });
  }
});
app.get("/googleDrive/files", checkAuth, GoogleDriveController.getDriveContent);
app.get(
  "/googleDrive/download/:id",
  checkAuth,
  GoogleDriveController.downloadDocument
);
app.get(
  "/googleDrive/downloadByPath",
  checkAuth,
  GoogleDriveController.downloadDocumentByPath
);

app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Не передан параметр code");

  try {
    await authorizeOnce(code);
    res.send("✅ Авторизация прошла успешно. Token сохранён.");
  } catch (err) {
    console.error("Ошибка авторизации:", err);
    res.status(500).send("❌ Ошибка при получении токена.");
  }
});

app.get("/googleDrive/auth", (req, res) => {
  try {
    const authUrl = getAuthUrl();
    res.redirect(authUrl); // <--- Вот как происходит перенаправление
  } catch (error) {
    console.error("Ошибка при генерации URL авторизации:", error);
    res
      .status(500)
      .send(
        "Не удалось начать процесс авторизации. Проверьте credentials.json."
      );
  }
});

app.listen(process.env.PORT || 4000, (err) => {
  if (err) {
    return console.log(err);
  }
  console.log("Server OK");
});

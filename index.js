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
  UserController,
  PostController,
  DocController,
  PhoneNumberController,
  SectionController,
  PremiseController,
  EnclosureItemController,
  TerminalblocksController,
  СhannelController,
  // GoogleDriveController
} from "./controllers/index.js";
import { verifyAdminRole } from "./utils/verifyRole.js";
import { v2 as cloudinary } from "cloudinary";
import fileUpload from "express-fileupload";
import { ALL_PERMISSIONS, ROLE_PERMISSIONS, ALL_ROLES } from "./utils/permissions.js";

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
    mongoUri ||
      "mongodb+srv://maksimkryglyk:prometey888@asutp.ofqp3js.mongodb.net/asutp"
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
      latest_app_version: latest_app_version || "2.0.0",
      force_update_min_version: force_update_min_version || "2.0.0",
      update_url_android:
        update_url_android ||
        "https://drive.google.com/uc?export=download&id=11X1g5k2V3nr85u-0ctrTKZYUrwPrLPxf",
      documents_zip_download_url:
        DOCUMENTS_ZIP_DOWNLOAD_URL ||
        "https://drive.google.com/file/d/11X1g5k2V3nr85u-0ctrTKZYUrwPrLPxf/view?usp=drive_link",
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
app.get("/auth/verify/:token", UserController.verifyEmail);
app.get("/auth/me", checkAuth, UserController.getMe);

app.get("/users", checkAuth, UserController.getAllUsers);
app.get("/users/changes", checkAuth, UserController.getChanges);
app.get("/users/:id", checkAuth, UserController.getUserById);
app.patch("/users/handleClearSync", UserController.handleClearSync);
app.patch("/users/batch-update", UserController.batchUpdateUsers);
app.patch("/users/:id", UserController.updateUserPassword);
app.patch("/users/:id/viewed-posts",
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

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "Пользователь не найден." });
    }
    res.json({ permissions: user.permissions || [] });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({
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
      return res
        .status(400)
        .json({
          message: `Неверные разрешения: ${invalidPermissions.join(", ")}`,
        });
    }

    const user = await User.findById(req.params.id);
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

app.get("/phoneNumbers", PhoneNumberController.getAll);
app.get("/phoneNumbers/:id", PhoneNumberController.getOne);
app.post("/phoneNumbers", checkAuth, PhoneNumberController.create);
app.delete("/phoneNumbers/:id", checkAuth, PhoneNumberController.remove);
app.patch("/phoneNumbers/:id", checkAuth, PhoneNumberController.update);

app.get("/tags", PostController.getLastTags);
app.get("/posts", PostController.getAll);
app.get("/posts/tags", PostController.getLastTags);
app.get("/posts/changes", checkAuth, PostController.getChanges);
app.get("/posts/:id", PostController.getOne);
app.post(
  "/posts",
  checkAuth,
  postCreateValidation,
  handleValidationErrors,
  PostController.create
);
app.post("/posts/batch-create", checkAuth, PostController.batchCreate);
app.post("/posts/batch-delete", checkAuth, PostController.batchDeletePosts);
app.patch("/posts/batch-update", checkAuth, PostController.batchUpdatePosts);

app.get("/docs/changes", DocController.getChanges);

app.post("/docs/batch-create", DocController.batchCreate);
app.post("/docs/batch-delete", DocController.batchDeleteDocs);
app.patch("/docs/batch-update", DocController.batchUpdate);

app.delete("/posts/:id", checkAuth, PostController.deletePost);

app.patch("/posts/:id/view", checkAuth, PostController.markPostAsViewed);

// --- МАРШРУТЫ ДЛЯ SECTIONS ---
app.post("/sections/batch-create", checkAuth, SectionController.createBatch);
app.patch("/sections/batch-update", checkAuth, SectionController.updateBatch);
app.post("/sections/batch-delete", checkAuth, SectionController.deleteBatch);
app.get("/sections/changes", checkAuth, SectionController.getChanges);

// --- МАРШРУТЫ ДЛЯ PREMISES ---
app.post("/premises/batch-create", checkAuth, PremiseController.createBatch);
app.patch("/premises/batch-update", checkAuth, PremiseController.updateBatch);
app.post("/premises/batch-delete", checkAuth, PremiseController.deleteBatch);
app.get("/premises/changes", checkAuth, PremiseController.getChanges);

// --- МАРШРУТЫ ДЛЯ ENCLOSUREITEMS ---
app.post("/enclosures/batch-create", checkAuth, EnclosureItemController.createBatch);
app.patch("/enclosures/batch-update",checkAuth, EnclosureItemController.updateBatch); 
app.post("/enclosures/batch-delete",checkAuth, EnclosureItemController.deleteBatch);
app.get("/enclosures/changes", checkAuth, EnclosureItemController.getChanges);

// --- МАРШРУТЫ ДЛЯ Terminalblocks ---
app.post("/terminalblocks/batch-create", checkAuth, TerminalblocksController.createBatch);
app.patch("/terminalblocks/batch-update", checkAuth, TerminalblocksController.updateBatch);
app.post("/terminalblocks/batch-delete", checkAuth, TerminalblocksController.deleteBatch);
app.get("/terminalblocks/changes", checkAuth, TerminalblocksController.getChanges);

// --- МАРШРУТЫ ДЛЯ Сhannel ---
app.post("/signals/batch-create", checkAuth, СhannelController.createBatch);
app.patch("/signals/batch-update", checkAuth, СhannelController.updateBatch);
app.post("/signals/batch-delete", checkAuth, СhannelController.deleteBatch);
app.get("/signals/changes", checkAuth, СhannelController.getChanges);


// app.get("/googleDisk/files", GoogleDriveController.getDriveContent);

app.listen(process.env.PORT || 4000, (err) => {
  if (err) {
    return console.log(err);
  }
  console.log("Server OK");
});

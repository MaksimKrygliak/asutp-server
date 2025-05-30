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
  PhoneNumberController,
} from "./controllers/index.js";
import { verifyAdminRole } from "./utils/verifyRole.js";
import { v2 as cloudinary } from "cloudinary";
import fileUpload from "express-fileupload";

const mongoUri = process.env.MONGODB_URI;
const cloud_name = process.env.CLOUD_NAME;
const api_key = process.env.API_KEY;
const api_secret = process.env.API_SECRET;
const latest_app_version = process.env.LATEST_APP_VERSION;
const force_update_min_version = process.env.FORCE_UPDATE_MIN_VERSION;

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
app.use("/uploads", express.static("uploads"));

cloudinary.config({
  cloud_name: cloud_name || "dhjnmoauc",
  api_key: api_key || "218662455584231",
  api_secret: api_secret || "ykr5JYbYBDOZDFc82Zs2eLUwcFQ",
});

app.post("/upload-avatar", checkAuth, async (req, res) => {
  try {
    if (!req.files || !req.files.avatar) {
      return res.status(400).json({ message: "Будь ласка, завантажте файл." });
    }

    const avatarFile = req.files.avatar;

    const result = await cloudinary.uploader.upload(avatarFile.tempFilePath, {
      resource_type: "image",
      folder: "avatars",
    });

    const avatarUrl = result.secure_url;

    res.json({ url: avatarUrl });
  } catch (error) {
    console.error("Помилка завантаження на Cloudinary:", error);
    res.status(500).json({ message: "Не вдалося завантажити зображення." });
  }
});

app.post("/upload", checkAuth, (req, res) => {
  if (!req.files || !req.files.image) {
    return res
      .status(400)
      .json({ message: "Будь ласка, завантажте зображення." });
  }

  const imageFile = req.files.image;
  const imageUrl = `http://192.168.0.131:4000/uploads/${imageFile.name}`;

  imageFile.mv(`./uploads/${imageFile.name}`, (err) => {
    if (err) {
      console.error("Помилка переміщення файлу:", err);
      return res
        .status(500)
        .json({ message: "Не вдалося зберегти зображення." });
    }
    res.json({ url: imageUrl });
  });
});

app.get("/app_config", (req, res) => {
  try {
    const config = {
      latest_app_version: latest_app_version || "2.0.0",
      force_update_min_version: force_update_min_version || "1.9.8",
      update_url_android:
        "https://drive.google.com/uc?export=download&id=11X1g5k2V3nr85u-0ctrTKZYUrwPrLPxf",
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

app.post("/auth/forgot-password:token", UserController.forgotPassword);
app.post("/auth/reset-password:token", UserController.resetPassword);

app.get("/users", checkAuth, UserController.getAllUsers);
app.get("/users/:id", checkAuth, UserController.getUserById);
app.patch("/users/:id", checkAuth, UserController.updateUser);
app.patch(
  "/users/:id/viewed-posts",
  checkAuth,
  UserController.updateViewedPosts
);

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

app.delete("/posts/:id", checkAuth, PostController.deletePost);
app.patch(
  "/posts/:id",
  checkAuth,
  handleValidationErrors,
  PostController.update
);

app.patch("/posts/:id/view", checkAuth, PostController.markPostAsViewed);

app.listen(process.env.PORT || 4000, (err) => {
  if (err) {
    return console.log(err);
  }
  console.log("Server OK");
});

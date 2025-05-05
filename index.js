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
if (!mongoUri) {
  console.error("Ошибка: Переменная окружения MONGODB_URI не определена.");
  process.exit(1);
}

mongoose
  // .connect(
  //   "mongodb+srv://maksimkryglyk:prometey888@asutp.ofqp3js.mongodb.net/asutp"
  // )
  .connect(mongoUri)
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
  cloud_name: "dhjnmoauc",
  api_key: "218662455584231",
  api_secret: "ykr5JYbYBDOZDFc82Zs2eLUwcFQ",
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
app.get("/users/:id", checkAuth, UserController.getUserById);
app.patch("/users/:id", checkAuth, UserController.updateUser);

app.get("/phoneNumbers", PhoneNumberController.getAll);
app.get("/phoneNumbers/:id", PhoneNumberController.getOne);
app.post("/phoneNumbers", checkAuth, PhoneNumberController.create);
app.delete("/phoneNumbers/:id", checkAuth, PhoneNumberController.remove);
app.patch("/phoneNumbers/:id", checkAuth, PhoneNumberController.update);

app.get("/tags", PostController.getLastTags);
app.get("/posts", PostController.getAll);
app.get("/posts/tags", PostController.getLastTags);
app.get("/posts/:id", PostController.getOne);
app.post(
  "/posts",
  checkAuth,
  postCreateValidation,
  handleValidationErrors,
  PostController.create
);
app.delete("/posts/:id", checkAuth, PostController.remove);
app.patch(
  "/posts/:id",
  checkAuth,
  // postCreateValidation,
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

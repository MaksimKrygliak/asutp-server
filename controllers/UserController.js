import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import UserModel from "../models/User.js";
import transporter from "../utils/nodemailerConfig.js";
import { v2 as cloudinary } from "cloudinary";

// const cloud_name = process.env.CLOUD_NAME;
// const api_key = process.env.API_KEY;
// const api_secret = process.env.API_SECRET;

// cloudinary.config({
//   cloud_name,
//   api_key,
//   api_secret,
// });

cloudinary.config({
  cloud_name: "dhjnmoauc",
  api_key: "218662455584231",
  api_secret: "ykr5JYbYBDOZDFc82Zs2eLUwcFQ",
});

const TOKEN_EXPIRATION_DATA = "30d";

export const register = async (req, res) => {
  try {
    const { fullName, email, engineerPosition, password } = req.body;

    // Перевірка, чи існує користувач з таким email
    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
      return res
        .status(409)
        .json({ message: "Користувач з таким email вже існує." });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const verificationToken = uuidv4();

    const doc = new UserModel({
      fullName,
      email,
      engineerPosition,
      passwordHash,
      verificationToken,
      isVerified: false,
    });

    // Обробка завантаження аватара, якщо файл присутній
    if (req.files && req.files.avatar) {
      const avatarFile = req.files.avatar;

      try {
        const result = await cloudinary.uploader.upload(
          avatarFile.tempFilePath
        );
        doc.avatarUrl = result.secure_url;
        doc.cloudinaryPublicId = result.public_id; // Зберігаємо public_id
      } catch (error) {
        console.error(
          "Помилка при завантаженні зображення на Cloudinary:",
          error
        );
        return res.status(500).json({
          message:
            "Помилка при завантаженні зображення.  Будь ласка, спробуйте ще раз.",
        });
      }
    }

    const user = await doc.save();

    const verificationLink = `${req.protocol}://${req.get(
      "host"
    )}/auth/verify/${verificationToken}`;
    const mailOptions = {
      to: email,
      subject: "Підтвердження реєстрації",
      html: `<p>Будь ласка, перейдіть за <a href="${verificationLink}">цим посиланням</a>, щоб підтвердити свій email у додатку ASUTP DIGITAL.</p>`,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Помилка при надсиланні листа:", error);
        return res.status(500).json({
          message: "Помилка під час надсилання листа для підтвердження email.",
        });
      }
      console.log("Лист відправлений:", info.response);
      res.status(201).json({
        message:
          "Реєстрація пройшла успішно. Будь ласка, підтвердіть свій email, перейшовши за посиланням, надісланим на вашу поштову адресу.",
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Не вдалося зареєструватись." });
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    const user = await UserModel.findOne({ verificationToken: token });

    if (!user) {
      return res
        .status(400)
        .json({ message: "Неправильний або застарілий токен підтвердження." });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();

    const jwtToken = jwt.sign({ _id: user._id, role: user.role }, "secret123", {
      expiresIn: TOKEN_EXPIRATION_DATA,
    });

    const { passwordHash, verificationToken: vt, ...userData } = user._doc;
    const redirectUrl = `asutpdigital://verification-success?token=${jwtToken}`;
    return res.redirect(redirectUrl);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Помилка під час підтвердження email." });
  }
};

export const login = async (req, res) => {
  try {
    const user = await UserModel.findOne({ email: req.body.email });

    if (!user) {
      return res.status(404).json({ message: "Користувача не знайдено." });
    }

    if (!user.isVerified) {
      return res.status(400).json({
        message: "Email не підтверджено. Будь ласка, перевірте свою пошту.",
      });
    }

    const isValidPass = await bcrypt.compare(
      req.body.password,
      user._doc.passwordHash
    );

    if (!isValidPass) {
      return res.status(400).json({ message: "Невірний пароль." });
    }

    const token = jwt.sign({ _id: user._id, role: user.role }, "secret123", {
      expiresIn: TOKEN_EXPIRATION_DATA,
    });

    const { passwordHash, verificationToken, ...userData } = user._doc;

    res.json({ ...userData, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Не вдалося авторизуватися." });
  }
};

export const getMe = async (req, res) => {
  try {
    const user = await UserModel.findById(req.userId);

    if (!user) {
      return res.status(404).json({ message: "Пользователь не найден." });
    }

    const { passwordHash, verificationToken, ...userData } = user._doc;

    res.json(userData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Нет доступа." });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const users = await UserModel.find().select("-passwordHash").exec();
    const totalCount = await UserModel.countDocuments();
    res.json({
      data: users,
      total: totalCount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Не удалось получить пользователей",
    });
  }
};

export const getUserById = async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await UserModel.findById(userId)
      .select("-passwordHash")
      .exec();
    if (!user) {
      return res.status(404).json({ message: "Користувача не знайдено" });
    }
    res.json(user);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Сервер, Не вдалося отримати дані користувача" });
  }
};

export const updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const { fullName, email, engineerPosition, password, role } = req.body;
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Користувача не знайдено" });
    }

    const updateData = { fullName, email, engineerPosition, role };

    if (password) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      updateData.passwordHash = hash;
    }

    // Обробка завантаження аватара, якщо файл присутній
    if (req.files && req.files.avatar) {
      const avatarFile = req.files.avatar;

      // Видалення старого зображення, якщо воно існує
      if (user.cloudinaryPublicId) {
        try {
          await cloudinary.uploader.destroy(user.cloudinaryPublicId);
        } catch (error) {
          console.error(
            "Помилка видалення старого зображення з Cloudinary:",
            error
          );
          // Не блокуємо оновлення користувача, але логуємо помилку
        }
      }

      const result = await cloudinary.uploader.upload(avatarFile.tempFilePath);
      updateData.avatarUrl = result.secure_url;
      updateData.cloudinaryPublicId = result.public_id; // Зберігаємо public_id
    }

    const updatedUser = await UserModel.findByIdAndUpdate(userId, updateData, {
      new: true,
    })
      .select("-passwordHash")
      .exec();

    res.json(updatedUser);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Не вдалося оновити дані користувача" });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await UserModel.findOne({ email });

    if (!user) {
      // Можна повернути успішну відповідь, щоб не розкривати існування email
      return res.status(200).json({
        message: "Лист для відновлення пароля відправлено на вказаний email.",
      });
    }

    const resetToken = uuidv4();
    const resetTokenExpiry = Date.now() + 3600000; // 1 година (в мілісекундах)

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiry = resetTokenExpiry;
    await user.save();
    const resetLink = `${req.protocol}://${req.get(
      "host"
    )}/auth/reset-password/${resetToken}`;

    const mailOptions = {
      to: email,
      subject: "Запит на відновлення пароля",
      html: `<p>Ви отримали цей лист, оскільки на ваш обліковий запис було надіслано запит на відновлення пароля.</p>
             <p>Будь ласка, перейдіть за <a href="${resetLink}">цим посиланням</a>, щоб скинути свій пароль. Посилання дійсне протягом 1 години.</p>
             <p>Якщо ви не надсилали цей запит, проігноруйте цей лист.</p>`,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error(
          "Помилка при надсиланні листа для відновлення пароля:",
          error
        );
        return res.status(500).json({
          message: "Помилка під час надсилання листа для відновлення пароля.",
        });
      }
      console.log("Лист для відновлення пароля відправлено:", info.response);
      res.status(200).json({
        message: "Лист для відновлення пароля відправлено на вказаний email.",
      });
    });
  } catch (err) {
    console.error("Помилка при обробці запиту на відновлення пароля:", err);
    res
      .status(500)
      .json({ message: "Не вдалося обробити запит на відновлення пароля." });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword, confirmNewPassword } = req.body;

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ message: "Нові паролі не співпадають." });
    }

    const user = await UserModel.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        message: "Недійсний або прострочений токен відновлення пароля.",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    user.passwordHash = passwordHash;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;
    await user.save();

    res.status(200).json({ message: "Пароль успішно скинуто." });
  } catch (err) {
    console.error("Помилка при скиданні пароля:", err);
    res.status(500).json({ message: "Не вдалося скинути пароль." });
  }
};

export const updateViewedPosts = async (req, res) => {
  const userId = req.params.id;
  console.log("111 - User ID:", userId);
  const { viewedPosts: clientViewedPostIds } = req.body; // Переименовываем, чтобы не путать
  console.log(req.body)
  console.log("222 - Client viewedPosts:", clientViewedPostIds);

  if (!Array.isArray(clientViewedPostIds)) {
    return res.status(400).json({ message: "viewedPosts must be an array." });
  }

  try {
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // 1. Получаем текущий список просмотренных постов из базы данных пользователя
    // Убедитесь, что user.viewedPostIds существует и является массивом.
    // Если viewedPostIds хранится как массив ObjectId, то map((id) => id.toString()) преобразует их в строки.
    // Если поле может быть null/undefined, используйте || []
    const currentViewedServerSet = new Set(
      (user.viewedPosts || []).map((id) => id.toString())
    );
    console.log(("user", user.viewedPosts))
    console.log(
      "Current viewed on server:",
      Array.from(currentViewedServerSet)
    );

    // 2. Находим новые ID из клиента, которых нет на сервере
    const newViewedFromClient = clientViewedPostIds.filter(
      (id) => !currentViewedServerSet.has(id.toString()) // Сравниваем client ID со списком на сервере
    );
    console.log(
      "newViewedFromClient (found new unique IDs from client):",
      newViewedFromClient
    );

    if (newViewedFromClient.length > 0) {
      // 3. Добавляем только новые уникальные ID к существующему списку пользователя
      // user.viewedPostIds.push(...newViewedFromClient); // Если user.viewedPostIds - это простой массив в схеме
      // Если это Mongoose Array, то push может быть достаточно
      // Но часто лучше использовать $addToSet или переназначить
      // Более надежный способ обновления массива в Mongoose:
      // Используем $addToSet, чтобы добавить новые элементы только если их еще нет.
      await UserModel.updateOne(
        { _id: userId },
        { $addToSet: { viewedPosts: { $each: newViewedFromClient } } }
      );
      // После обновления в БД, нужно получить обновленный документ, чтобы вернуть его
      const updatedUser = await UserModel.findById(userId);
      console.log("updatedUser", updatedUser)
      user.viewedPosts = updatedUser.viewedPosts; // Обновляем локальный объект user

      console.log(
        `User ${userId} viewedPost successfully updated with ${newViewedFromClient.length} new IDs.`
      );
    } else {
      console.log(
        `User ${userId} viewedPost already up-to-date. No new viewed posts to add.`
      );
    }

    // 4. Возвращаем актуальный список просмотренных постов из ОБНОВЛЕННОГО объекта user
    return res.status(200).json({
      success: true,
      message: "Список просмотренных постов успешно обновлен",
      viewedPosts: (user.viewedPosts || []).map((id) => id.toString()), // Возвращаем то, что сейчас в БД
    });
  } catch (err) {
    console.error("Error updating viewed posts:", err);
    return res
      .status(500)
      .json({ message: "Failed to update viewed posts.", error: err.message });
  }
};
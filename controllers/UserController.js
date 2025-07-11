import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import UserModel from "../models/User.js";
import transporter from "../utils/nodemailerConfig.js";
import { v2 as cloudinary } from "cloudinary";
import mongoose from "mongoose";
const ObjectId = mongoose.Types.ObjectId;

const cloud_name = process.env.CLOUD_NAME;
const api_key = process.env.API_KEY;
const api_secret = process.env.API_SECRET;

cloudinary.config({
  cloud_name: cloud_name || "dhjnmoauc",
  api_key: api_key || "218662455584231",
  api_secret: api_secret || "ykr5JYbYBDOZDFc82Zs2eLUwcFQ",
});

const TOKEN_EXPIRATION_DATA = "90d";

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
      lastSyncTimes: {
        documents: new Date(0),
        notes: new Date(0),
        users: new Date(0),
      },
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
  const { email, password } = req.body;
  try {
    const user = await UserModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "Користувача не знайдено." });
    }

    if (!user.isVerified) {
      return res.status(400).json({
        message: "Email не підтверджено. Будь ласка, перевірте свою пошту.",
      });
    }

    const isValidPass = await bcrypt.compare(password, user._doc.passwordHash);

    if (!isValidPass) {
      return res.status(400).json({ message: "Невірний пароль." });
    }

    const token = jwt.sign({ _id: user._id, role: user.role }, "secret123", {
      expiresIn: TOKEN_EXPIRATION_DATA,
    });
    const { passwordHash, verificationToken, ...userData } = user._doc;

    res.json({ token });
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
    res.json({
      data: users,
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
    console.log("user", user);
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
  const { viewedPostsArray } = req.body; // Це масив рядків, отриманий з клієнта
  if (!Array.isArray(viewedPostsArray)) {
    return res
      .status(400)
      .json({ message: "viewedPostsArray повинен бути масивом" });
  }

  try {
    // 1. Знайдіть користувача в базі даних
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Користувач не знайдений" });
    }

    // 2. Отримайте поточний список viewedPosts користувача з БД і перетворіть його на Set рядків для швидкого пошуку
    // Переконуємось, що viewedPosts існує і є масивом
    const currentViewedServerSet = new Set(
      (user.viewedPosts || []).map((id) => id.toString())
    );

    // 3. Фільтруємо viewedPostsArray, щоб знайти лише ті ID, яких ще немає на сервері
    // Валідуємо і перетворюємо кожен ID у ObjectId
    const newUniqueViewedFromClient = [];
    for (const idString of viewedPostsArray) {
      try {
        // Спробуємо створити ObjectId. Якщо рядок недійсний, це викине помилку.
        const objectId = new ObjectId(idString);
        if (!currentViewedServerSet.has(objectId.toString())) {
          newUniqueViewedFromClient.push(objectId); // Додаємо як ObjectId
        }
      } catch (e) {
        console.warn(`Недійсний ObjectId від клієнта: ${idString}. Пропущено.`);
        // Можна відправити помилку клієнту або просто проігнорувати недійсні ID
      }
    }

    console.log(
      "Нові унікальні ID з клієнта (як ObjectId):",
      newUniqueViewedFromClient
    );

    // 4. Оновлюємо документ користувача в MongoDB, використовуючи $addToSet для додавання нових унікальних ID
    if (newUniqueViewedFromClient.length > 0) {
      const result = await UserModel.updateOne(
        { _id: userId },
        { $addToSet: { viewedPosts: { $each: newUniqueViewedFromClient } } }
      );
      console.log(`Результат оновлення MongoDB:`, result);

      // Отримайте оновлений документ користувача після операції, щоб повернути актуальні дані
      // Або, якщо ви впевнені, що операція успішна, можна оновити локальний об'єкт 'user'
      // Але краще перечитати з БД для надійності
      const updatedUser = await UserModel.findById(userId);

      return res.status(200).json({
        success: true,
        message: "Список проглянутих постів успішно оновлено",
        // Повертаємо актуальний список viewedPosts як масив рядків
        viewedPosts: (updatedUser.viewedPosts || []).map((id) => id.toString()),
      });
    } else {
      console.log(
        `Користувач ${userId} viewedPosts вже актуальний. Немає нових переглянутих постів для додавання.`
      );
      // Якщо немає нових постів для додавання, все одно повертаємо поточний стан
      return res.status(200).json({
        success: true,
        message: "Список проглянутих постів вже актуальний",
        viewedPosts: (user.viewedPosts || []).map((id) => id.toString()), // Повертаємо існуючі
      });
    }
  } catch (err) {
    console.error("Помилка при оновленні проглянутих постів:", err);
    // Обробка помилок парсингу ObjectId (наприклад, якщо client send 'invalid_id')
    if (err.name === "BSONTypeError" || err.name === "CastError") {
      return res
        .status(400)
        .json({ message: "Один або декілька ID постів є недійсними." });
    }
    return res.status(500).json({
      message: "Не вдалося оновити проглянуті пости.",
      error: err.message,
    });
  }
};

export const batchUpdateUsers = async (req, res) => {
  const usersArr = req.body; // Это массив объектов пользователей от клиента

  if (!Array.isArray(usersArr) || usersArr.length === 0) {
    return res.status(400).json({
      message: "Тело запроса должно быть непустым массивом пользователей.",
      successUpdatedUsers: [],
      failedUpdatedUsers: [],
    });
  }

  const updatePromises = usersArr.map(async (userToUpdate) => {
    try {
      if (!userToUpdate._id) {
        throw new Error("Отсутствует _id для обновления пользователя");
      }

      const updatePayload = { ...userToUpdate };
      delete updatePayload.passwordHash;

      // Получаем текущего пользователя из БД, чтобы обновить только нужные поля
      // и затем обновить lastSyncTimes
      const existingUser = await UserModel.findById(userToUpdate._id);

      if (!existingUser) {
        return {
          status: "rejected",
          value: {
            _id: userToUpdate._id,
            message: "Пользователь не найден на сервере.",
          },
        };
      }

      // Применяем пришедшие от клиента обновления к существующему пользователю
      // Исключаем _id, createdAt, updatedAt, и lastSyncTimes, так как они обрабатываются отдельно или самим Mongoose
      for (const key in updatePayload) {
        if (key !== '_id' && key !== 'createdAt' && key !== 'updatedAt' && key !== 'lastSyncTimes') {
            existingUser[key] = updatePayload[key];
        }
      }

      // --- ВАЖНОЕ ИСПРАВЛЕНИЕ: Обновляем lastSyncTimes.users на текущее время на сервере ---
      // Если lastSyncTimes существует, обновляем только users, иначе создаем объект
      if (!existingUser.lastSyncTimes) {
          existingUser.lastSyncTimes = {};
      }
      existingUser.lastSyncTimes.users = new Date(); // Устанавливаем текущее время на сервере
      // Вы также можете рассмотреть обновление documents и notes здесь,
      // если этот endpoint отвечает за их синхронизацию, а не только за users
      // Например, если client.synced === false, значит он отправил изменения,
      // и теперь все эти поля должны быть обновлены на текущее время.

      const updatedUser = await existingUser.save(); // Сохраняем изменения

      // Возвращаем обновленные данные пользователя для успешной обработки
      return { status: "fulfilled", value: updatedUser.toJSON() };
    } catch (error) {
      console.error(
        `Ошибка при обновлении пользователя с ID ${userToUpdate._id}:`,
        error
      );
      return {
        status: "rejected",
        value: {
          _id: userToUpdate._id,
          message:
            error.message ||
            "Внутренняя ошибка сервера при обновлении пользователя.",
        },
      };
    }
  });

  const results = await Promise.allSettled(updatePromises);

  const successUpdatedUsers = [];
  const failedUpdatedUsers = [];

  results.forEach((result) => {
    if (result.status === "fulfilled") {
      successUpdatedUsers.push(result.value);
    } else {
      failedUpdatedUsers.push(result.reason.value);
    }
  });

  const serverTimestamp = new Date();
  res.status(200).json({
    message: "Пакетное обновление пользователей завершено.",
    successUpdatedUsers: successUpdatedUsers,
    failedUpdatedUsers: failedUpdatedUsers,
    serverCurrentTimestamp: serverTimestamp.toISOString(),
  });
};

// export const batchUpdateUsers = async (req, res) => {
//   const usersArr = req.body; // Это массив объектов пользователей от клиента

//   if (!Array.isArray(usersArr) || usersArr.length === 0) {
//     return res.status(400).json({
//       message: "Тело запроса должно быть непустым массивом пользователей.",
//       successUpdatedUsers: [],
//       failedUpdatedUsers: [],
//     });
//   }

//   const updatePromises = usersArr.map(async (userToUpdate) => {
//     try {
//       // Ключевой момент: id приходит как строка, Mongoose может ее сам конвертировать,
//       // но явное преобразование в ObjectId иногда полезно для строгости.
//       // Однако, для findByIdAndUpdate, обычно достаточно строки.
//       // Убедитесь, что _id существует в userToUpdate
//       if (!userToUpdate._id) {
//         throw new Error("Отсутствует _id для обновления пользователя");
//       }

//       // Если в client передаются поля, которые не должны быть обновлены или требуют особой обработки,
//       // создайте здесь объект 'updatePayload' из 'userToUpdate', исключив ненужное.
//       // Например, если passwordHash никогда не должен приходить от клиента для batchUpdateUsers:
//       const updatePayload = { ...userToUpdate };
//       delete updatePayload.passwordHash; // Никогда не обновляем пароль через пакетное обновление

//       const updatedUser = await UserModel.findByIdAndUpdate(
//         userToUpdate._id,
//         updatePayload, // Используем очищенный payload
//         { new: true }
//       )
//         .select("-passwordHash")
//         .exec();

//       if (!updatedUser) {
//         // Если пользователь не найден по ID
//         return {
//           status: "rejected",
//           value: {
//             _id: userToUpdate._id,
//             message: "Пользователь не найден на сервере.",
//           },
//         };
//       }

//       // Возвращаем обновленные данные пользователя для успешной обработки
//       return { status: "fulfilled", value: updatedUser.toJSON() }; // .toJSON() для чистого JS объекта
//     } catch (error) {
//       // Ловим любую ошибку, произошедшую при обновлении конкретного пользователя
//       console.error(
//         `Ошибка при обновлении пользователя с ID ${userToUpdate._id}:`,
//         error
//       );
//       return {
//         status: "rejected",
//         value: {
//           _id: userToUpdate._id,
//           message:
//             error.message ||
//             "Внутренняя ошибка сервера при обновлении пользователя.",
//         },
//       };
//     }
//   });

//   const results = await Promise.allSettled(updatePromises);

//   const successUpdatedUsers = [];
//   const failedUpdatedUsers = [];

//   // Обрабатываем результаты всех промисов
//   results.forEach((result) => {
//     if (result.status === "fulfilled") {
//       successUpdatedUsers.push(result.value);
//     } else {
//       failedUpdatedUsers.push(result.reason.value); // 'reason' содержит объект, который мы вернули при 'rejected'
//     }
//   });

//   // Отправляем ОДИН ответ клиенту с обобщенными результатами
//   const serverTimestamp = new Date(); // Текущее время на сервере для синхронизации
//   res.status(200).json({
//     message: "Пакетное обновление пользователей завершено.",
//     successUpdatedUsers: successUpdatedUsers,
//     failedUpdatedUsers: failedUpdatedUsers,
//     serverCurrentTimestamp: serverTimestamp.toISOString(), // Полезно для клиента
//   });
// };

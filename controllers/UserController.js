import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import UserModel from "../models/User.js";
import transporter from "../utils/nodemailerConfig.js";
import { v2 as cloudinary } from "cloudinary";
import mongoose from "mongoose";
import sendMessage from "../utils/sendMessage.js";
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
    const { fullName, email, engineerPosition, brigade, password } = req.body;

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
      brigade,
      passwordHash,
      verificationToken,
      isVerified: false,
      lastSyncTimes: {
        documents: new Date(0),
        notes: new Date(0),
        users: new Date(0),
        sections: new Date(0),
        premises: new Date(0),
        closet: new Date(0),
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

const renderHtmlMessage = (title, message, isSuccess = false) => {
  const bgColor = isSuccess ? "#34D399" : "#F87171";
  const textColor = "#1F2937";

  return `
    <!DOCTYPE html>
    <html lang="uk">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                margin: 0;
                padding: 40px;
                background-color: #F3F4F6;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
            }
            .container {
                max-width: 400px;
                padding: 30px;
                border-radius: 12px;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
                text-align: center;
                background-color: #FFFFFF;
                border-left: 8px solid ${bgColor};
            }
            h1 {
                color: ${textColor};
                font-size: 24px;
                margin-bottom: 15px;
            }
            p {
                color: #4B5563;
                font-size: 16px;
                margin-bottom: 0;
            }
            .status-indicator {
                font-size: 32px;
                margin-bottom: 20px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="status-indicator">${isSuccess ? "✅" : "❌"}</div>
            <h1>${title}</h1>
            <p>${message}</p>
        </div>
    </body>
    </html>
  `;
};

export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    const user = await UserModel.findOne({ verificationToken: token });

    if (!user) {
      // ИЗМЕНЕНИЕ: Возвращаем HTML-страницу вместо JSON, чтобы пользователь в браузере
      // увидел дружелюбное сообщение об ошибке.
      return res
        .status(400)
        .send(
          renderHtmlMessage(
            "Помилка підтвердження",
            "Неправильний або застарілий токен підтвердження. Спробуйте увійти або повторно надіслати лист.",
            false
          )
        );
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();

    const jwtToken = jwt.sign({ _id: user._id, role: user.role }, "secret123", {
      expiresIn: TOKEN_EXPIRATION_DATA,
    });

    sendMessage(
      "Новий користувач",
      `"${user.fullName}" приєднався до нас!`,
      { 
        notificationType: "NEW_USER_VERIFIED", // Добавил более специфичный тип
        userId: user._id.toString(),
      },
      true
    ).catch((err) => {
      // Логгируем ошибку, но не блокируем основной поток и не отправляем 500 клиенту
      console.error(
        "Ошибка при отправке уведомления о новом пользователе:",
        err
      );
    });

    const redirectUrl = `asutpdigital://verification-success?token=${jwtToken}`;
    res.redirect(redirectUrl);
  } catch (err) {
    console.error(err);
    // ИЗМЕНЕНИЕ: Возвращаем HTML-страницу в случае критической ошибки сервера.
    res
      .status(500)
      .send(
        renderHtmlMessage(
          "Критична помилка сервера",
          "Виникла внутрішня помилка сервера. Будь ласка, спробуйте пізніше.",
          false
        )
      );
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
    const { lastSyncTime } = req.query;
    let query = {};

    if (lastSyncTime) {
      const clientLastSyncTime = new Date(lastSyncTime);
      query = { "lastSyncTimes.users": { $gt: clientLastSyncTime } };
    }

    // ИЗМЕНИТЕ ЭТУ СТРОКУ:
    const users = await UserModel.find(query); // <-- Здесь должно быть UserModel.find(query);

    const serverCurrentTimestamp = new Date();

    res.status(200).json({
      status: "success",
      results: users.length,
      data: users,
      serverCurrentTimestamp: serverCurrentTimestamp.toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: err.message,
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

export const updateUserPassword = async (req, res) => {
  try {
    const userId = req.params.id;
    const { fullName, email, engineerPosition, brigade, password, role } =
      req.body;
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Користувача не знайдено" });
    }

    const updateData = { fullName, email, engineerPosition, brigade, role };

    if (password) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      updateData.passwordHash = hash;
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

export const handleClearSync = async (req, res) => {
  const usersArr = req.body;
  console.log("req", req);
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

    // 4. Оновлюємо документ користувача в MongoDB, використовуючи $addToSet для додавання нових унікальних ID
    if (newUniqueViewedFromClient.length > 0) {
      const result = await UserModel.updateOne(
        { _id: userId },
        { $addToSet: { viewedPosts: { $each: newUniqueViewedFromClient } } }
      );

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
  const usersArr = req.body;

  if (!Array.isArray(usersArr) || usersArr.length === 0) {
    return res.status(400).json({
      message: "Тело запроса должно быть непустым массивом пользователей.",
      successUpdatedUsers: [],
      failedUpdatedUsers: [],
    });
  }

  const updatePromises = usersArr.map(async (user) => {
    try {
      if (!user._id) {
        throw new Error("Отсутствует _id для обновления пользователя");
      }

      const mongoDbUser = await UserModel.findById(user._id);

      if (!mongoDbUser) {
        return {
          status: "rejected",
          reason: {
            _id: user._id,
            message: "Пользователь не найден на сервере.",
          },
        };
      }

      // ✅ Применяем пришедшие от клиента обновления
      for (const key in user) {
        if (
          key !== "_id" &&
          key !== "createdAt" &&
          key !== "updatedAt" &&
          key !== "lastSyncTimes"
        ) {
          mongoDbUser[key] = user[key];
        }
      }

      // ✅ УДАЛЯЕМ ЛОГИКУ ОБНОВЛЕНИЯ lastSyncTimes
      // if (updatePayload.lastSyncTimes) { ... }

      await mongoDbUser.save();
      // ✅ Возвращаем только строку ID
      return { status: "fulfilled", value: user._id };
    } catch (error) {
      console.error(
        `Ошибка при обновлении пользователя с ID ${user._id}:`,
        error
      );
      return {
        status: "rejected",
        reason: {
          _id: user._id,
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
      failedUpdatedUsers.push(result.reason);
    }
  });

  res.status(200).json({
    message: "Пакетное обновление пользователей завершено.",
    successUpdatedUsers: successUpdatedUsers,
    failedUpdatedUsers: failedUpdatedUsers,
  });
};

export const getChanges = async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(0);

    const createdOrUpdatedUsers = await UserModel.find({
      $or: [{ updatedAt: { $gte: since } }, { createdAt: { $gte: since } }],
      isDeleted: { $ne: true },
    })
      .lean()
      .exec();

    const deletedUsersIds = await UserModel.find(
      { isDeleted: true, updatedAt: { $gte: since } },
      "_id"
    )
      .lean()
      .exec()
      .then((docs) => docs.map((doc) => doc._id.toString()));

    const serverCurrentTimestamp = new Date().toISOString();

    // ✅ УДАЛЯЕМ СТРОКИ, КОТОРЫЕ СОХРАНЯЮТ ВРЕМЯ НА СЕРВЕРЕ
    // const mongoDbUser = await UserModel.findById(userServerId);
    // mongoDbUser.lastSyncTimes.users = serverCurrentTimestamp;
    // await mongoDbUser.save();

    res.json({
      createdOrUpdatedUsers,
      deletedUsersIds,
      serverCurrentTimestamp,
    });
  } catch (err) {
    console.error("Server: Ошибка в контроллере getChanges:", err);
    res.status(500).json({
      message: "Не удалось получить изменения.",
      error: err.message,
    });
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

export const photoProfile = async (req, res) => {
  try {
    if (!req.files || !req.files.avatar) {
      return res.status(400).json({ message: "Будь ласка, завантажте файл." });
    }
    const avatarFile = req.files.avatar;
    const userId = req.params.id;
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Користувача не знайдено." });
    }

    let oldCloudinaryPublicId = user.cloudinaryPublicId;

    const result = await cloudinary.uploader.upload(avatarFile.tempFilePath, {
      resource_type: "image",
      folder: "avatars",
    });

    const newAvatarUrl = result.secure_url;
    const newCloudinaryPublicId = result.public_id;

    await UserModel.findByIdAndUpdate(
      userId,
      {
        avatarUrl: newAvatarUrl,
        cloudinaryPublicId: newCloudinaryPublicId,
      },
      { new: true }
    );

    if (oldCloudinaryPublicId) {
      await cloudinary.uploader.destroy(oldCloudinaryPublicId);
    }

    res.json({ url: newAvatarUrl, publicId: newCloudinaryPublicId });
  } catch (error) {
    console.error("Помилка завантаження на Cloudinary:", error);
    res.status(500).json({ message: "Не вдалося завантажити зображення." });
  }
};

export const deletePhotoProfile = async (req, res) => {
  try {
    const userId = req.params.id; // ID пользователя, переданный через checkAuth
    // const userIdFromParams = req.params.id; // Если вы хотите удалять аватар другого пользователя по ID

    // Важно: убедитесь, что только пользователь или администратор может удалить свой аватар
    // if (userId !== userIdFromParams && req.userRole !== 'адміністратор') {
    //   return res.status(403).json({ message: "У вас немає дозволу на видалення цього аватара." });
    // }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Користувача не знайдено." });
    }

    const publicIdToDelete = user.cloudinaryPublicId;

    if (!publicIdToDelete) {
      return res
        .status(400)
        .json({ message: "У користувача немає аватара для видалення." });
    }

    // Удаляем аватар из Cloudinary
    await cloudinary.uploader.destroy(publicIdToDelete);

    // Обновляем пользователя в базе данных: удаляем avatarUrl и cloudinaryPublicId
    await UserModel.findByIdAndUpdate(
      userId,
      {
        $unset: {
          avatarUrl: "", // Удаляет поле avatarUrl
          cloudinaryPublicId: "", // Удаляет поле cloudinaryPublicId
        },
      },
      { new: true }
    );

    res.json({ message: "Аватар успішно видалено." });
  } catch (error) {
    console.error("Помилка видалення аватара з Cloudinary:", error);
    res.status(500).json({ message: "Не вдалося видалити зображення." });
  }
};

export const updateAppVersion = async (req, res) => {
  // 1. Получение ID пользователя из объекта запроса.
  // Предполагается, что ваш middleware для аутентификации уже добавил user.id в req.user
  const userId = req.userId;

  // 2. Получение данных из тела запроса
  const { appVersion } = req.body;

  // 3. Базовая валидация данных
  if (!appVersion || typeof appVersion !== "string" || appVersion.length > 20) {
    return res.status(400).json({
      message:
        "Неверный или отсутствующий номер версии приложения (appVersion).",
    });
  }

  // 4. Логика обновления в базе данных
  try {
    // Мы используем плейсхолдер User.findByIdAndUpdate
    // В реальном приложении это будет вызов MongoDB (Mongoose), SQL (Sequelize/Prisma) и т.д.
    const updatedUser = await UserModel.findByIdAndUpdate(
      userId,
      {
        appVersion: appVersion,
      },
      { new: true, runValidators: true } // { new: true } возвращает обновленный документ
    );

    // Проверка, найден ли пользователь
    if (!updatedUser) {
      return res.status(404).json({ message: "Пользователь не найден." });
    }

    // 5. Успешный ответ
    return res.status(200).json({
      message: "Версия приложения успешно обновлена.",
      currentVersion: updatedUser.appVersion,
    });
  } catch (error) {
    console.error("Ошибка при обновлении версии приложения:", error);

    // 6. Обработка ошибок БД
    return res.status(500).json({
      message: "Ошибка сервера при обновлении записи.",
      error: error.message,
    });
  }
};

export const updatePushToken = async (req, res) => {
  const userId = req.userId; // Получаем из checkAuth middleware
  const { pushToken } = req.body;

  if (!pushToken || typeof pushToken !== "string") {
    return res.status(400).json({ message: "Отсутствует pushToken." });
  }

  try {
    await UserModel.findByIdAndUpdate(
      userId,
      { fcmToken: pushToken },
      { new: true }
    );
    return res.status(200).json({ message: "Push-токен успешно сохранен." });
  } catch (error) {
    console.error("Ошибка сохранения push-токена:", error);
    return res.status(500).json({ message: "Ошибка сервера." });
  }
};

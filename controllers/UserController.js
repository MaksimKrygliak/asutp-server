import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import UserModel from "../models/User.js";
import transporter from "../utils/nodemailerConfig.js"; // Убедитесь, что путь правильный

const TOKEN_EXPIRATION_DATA = "7d";

export const register = async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "Пользователь с таким email уже существует." });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const verificationToken = uuidv4();

    const doc = new UserModel({
      fullName,
      email,
      passwordHash,
      verificationToken,
      isVerified: false,
    });

    const user = await doc.save();

    const verificationLink = `${req.protocol}://${req.get(
      "host"
    )}/auth/verify/${verificationToken}`; // Используем протокол и хост из запроса

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

    if (user) {
      // ... (код верификации пользователя)

      user.isVerified = true;
      user.verificationToken = undefined;
      await user.save();

      const jwtToken = jwt.sign(
        { _id: user._id, role: user.role },
        "secret123",
        {
          expiresIn: TOKEN_EXPIRATION_DATA,
        }
      );

      const { passwordHash, verificationToken: vt, ...userData } = user._doc;
      const redirectUrl = `asutpdigital://verification-success?token=${jwtToken}`;
      return res.redirect(redirectUrl);
    } else {
      return res
        .status(400)
        .json({ message: "Неправильний або застарілий токен підтвердження." });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Помилка під час підтвердження email." });
  }
};

export const login = async (req, res) => {
  try {
    const user = await UserModel.findOne({ email: req.body.email });

    if (!user) {
      return res.status(404).json({ message: "Пользователь не найден." });
    }

    if (!user.isVerified) {
      return res.status(400).json({
        message: "Email не подтвержден. Пожалуйста, проверьте свою почту.",
      });
    }

    const isValidPass = await bcrypt.compare(
      req.body.password,
      user._doc.passwordHash
    );

    if (!isValidPass) {
      return res.status(400).json({ message: "Неверный пароль." });
    }

    const token = jwt.sign({ _id: user._id, role: user.role }, "secret123", {
      expiresIn: TOKEN_EXPIRATION_DATA,
    });

    const { passwordHash, verificationToken, ...userData } = user._doc; // Исключаем verificationToken

    res.json({ ...userData, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Не удалось авторизоваться." });
  }
};

export const getMe = async (req, res) => {
  try {
    const user = await UserModel.findById(req.userId);

    if (!user) {
      return res.status(404).json({ message: "Пользователь не найден." });
    }

    const { passwordHash, verificationToken, ...userData } = user._doc; // Исключаем verificationToken

    res.json(userData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Нет доступа." });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const users = await UserModel.find().select('-passwordHash').exec(); // Исключаем пароль из ответа
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
    const user = await UserModel.findById(userId).select('-passwordHash').exec();
    if (!user) {
      return res.status(404).json({ message: 'Користувача не знайдено' });
    }
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Не вдалося отримати дані користувача' });
  }
};

export const updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const { fullName, email, role, password } = req.body;
    const updateData = { fullName, email, role };

    if (password) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      updateData.passwordHash = hash;
    }

    const updatedUser = await UserModel.findByIdAndUpdate(userId, updateData, { new: true }).select('-passwordHash').exec();

    if (!updatedUser) {
      return res.status(404).json({ message: 'Користувача не знайдено' });
    }

    res.json(updatedUser);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Не вдалося оновити дані користувача' });
  }
};
import jwt from "jsonwebtoken";
import axios from "axios";
import User from "../models/User.js";

export const auth = async (req, res) => {
  try {
    const { access_token } = req.body;

    if (!access_token) {
      return res.status(400).json({ message: "Токен відсутній" });
    }

    // 1. Перевіряємо токен у Microsoft і дістаємо пошту
    // Це найважливіший крок безпеки - ми не віримо телефону, ми віримо Microsoft
    const msResponse = await axios.get("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    // console.log(msResponse.data);
    const {
      mail,
      userPrincipalName,
      displayName,
      id: microsoftId,
    } = msResponse.data;

    const email = mail || userPrincipalName;

    if (!email) {
      return res
        .status(400)
        .json({ message: "Не вдалося отримати Email від Microsoft" });
    }

    // 2. Шукаємо користувача в базі
    let user = await User.findOne({ email: email.toLowerCase() });

    // 3. Якщо користувача немає — створюємо (або повертаємо помилку, якщо реєстрація закрита)
    if (!user) {
      user = new User({
        microsoftId: microsoftId,
        fullName: displayName,
        email: email.toLowerCase(),
        engineerPosition: "Інший",
        brigade: 0,
      });

      await user.save();
    }

    // 4. Генеруємо ВАШ токен (JWT)
    // Саме цей токен React Native збереже в AsyncStorage
    const token = jwt.sign(
      {
        _id: user._id,
        email: user.email,
        role: user.role, // якщо є ролі
      },
      process.env.JWT_SECRET || "secret123",
      { expiresIn: "90d" } // Цей токен живе довго
    );

    // 5. Відправляємо результат
    res.json({
      token, // <-- Це те, що чекає ваш AuthContext
      user,
    });
  } catch (error) {
    console.error("Помилка Microsoft Auth:", error.message);
    res.status(401).json({ message: "Невалідна авторизація Microsoft" });
  }
};

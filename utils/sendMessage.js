import UserModel from "../models/User.js";
import { sendPushNotification } from "../utils/notificationService.js";

async function getAllActiveFcmTokens(roleFilter = null) {
  try {
    // Базовый запрос: ищем пользователей с активными токенами
    const query = {
      fcmToken: { $exists: true, $ne: null },
    };

    // Если указан фильтр по роли, добавляем его в запрос
    if (roleFilter) {
      query.role = roleFilter;
    }

    const tokens = await UserModel.find(query).select("fcmToken").lean();

    // Преобразуем массив объектов { fcmToken: '...' } в плоский массив строк, отфильтровывая null/undefined
    return tokens.map((user) => user.fcmToken).filter((token) => token);
  } catch (error) {
    console.error("Ошибка при получении FCM токенов:", error);
    return [];
  }
}

export default async function sendMessage(
  title,
  body,
  data = { batchUpdate: "true" },
  sendToAdminsOnly = false // Новый аргумент для фильтрации по роли
) {
  let allTokens = [];
  try {
    let tokenFetcher;

    // Определяем, какие токены нужно получить
    if (sendToAdminsOnly) {
      console.log("Инициирована отправка уведомления ТОЛЬКО администраторам.");
      tokenFetcher = getAllActiveFcmTokens("адміністратор"); // Запрашиваем только токены с role: 'admin'
    } else {
      console.log(
        "Инициирована отправка уведомления ВСЕМ активным пользователям."
      );
      tokenFetcher = getAllActiveFcmTokens(); // Запрашиваем все активные токены
    }

    allTokens = await tokenFetcher;

    if (allTokens.length > 0) {
      // Отправляем уведомления асинхронно
      allTokens.forEach((token) => {
        sendPushNotification(token, title, body, data).catch((err) => {
          // Логгируем ошибки отправки конкретному токену
          console.error(
            `Ошибка при отправке уведомления токену ${token}:`,
            err.message
          );
        });
      });

      return {
        success: true,
        totalTokens: allTokens.length,
        message: `Массовая рассылка уведомлений инициирована. Целевая аудитория: ${
          sendToAdminsOnly ? "администраторы" : "все активные пользователи"
        }.`,
      };
    } else {
      const target = sendToAdminsOnly ? "администраторов" : "активных токенов";
      return {
        success: false,
        totalTokens: 0,
        message: `Нет ${target} для рассылки.`,
      };
    }
  } catch (error) {
    console.error("Помилка відправки Push:", error);
    return {
      success: false,
      totalTokens: allTokens.length,
      message:
        "Ошибка сервера при получении токенов или инициировании рассылки.",
    };
  }
}

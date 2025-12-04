// scripts/sendUpdateReminder.js

import UserModel from "../models/User.js";
import { firebaseAdmin } from "../utils/firebaseAdmin.js";
// ... (Ваша функция для сравнения версий, например, npm install node-version-compare)

const LATEST_APP_VERSION = "3.3.1"; // <-- Укажите здесь новую версию
const MIN_VERSION_FOR_PUSH = "1.0.0"; // Минимальная версия для рассылки

const sendUpdateNotification = async () => {
  // 1. Найти всех пользователей, которые нуждаются в обновлении
  // (Фильтрация по версии - это пример, может потребоваться более сложная логика)
  const usersToNotify = await UserModel.find({
    // Пример упрощенной фильтрации:
    fcmToken: { $exists: true }, // Только те, у кого есть токен
    // Здесь потребуется более сложный запрос или цикл с сравнением версий
  });

  let tokens = [];
  usersToNotify.forEach((user) => {
    // Здесь мы должны сравнить user.appVersion с LATEST_APP_VERSION
    if (
      compareVersions(
        user.appVersion || MIN_VERSION_FOR_PUSH,
        LATEST_APP_VERSION
      ) < 0
    ) {
      tokens.push(user.fcmToken);
    }
  });

  if (tokens.length === 0) {
    console.log(
      "Все пользователи имеют последнюю версию. Рассылка не требуется."
    );
    return;
  }

  // 2. Сформировать сообщение
  const message = {
    notification: {
      title: "Новое Обновление Доступно! 🚀",
      body: `Версия ${LATEST_APP_VERSION} уже вышла! Обновите приложение для доступа к новым функциям.`,
    },
    data: {
      updateRequired: "true",
      url: "appstore_or_playstore_url", // Можно отправить URL для прямого перехода
    },
  };

  // 3. Отправить уведомления
  try {
    const response = await firebaseAdmin.messaging().sendEachForMulticast({
      tokens: tokens,
      ...message,
    });

    console.log(
      `Успешно отправлено ${response.successCount} уведомлений.`,
      response.responses
    );
    // Важно: Обработать failedTokens (токены, которые нужно удалить из БД)
  } catch (error) {
    console.error("Ошибка при отправке FCM-уведомлений:", error);
  }
};

// Вызовите sendUpdateNotification();

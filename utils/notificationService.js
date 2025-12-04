// services/notificationService.js
import admin from "firebase-admin";

// 1. Асинхронная загрузка JSON-ключа с использованием Top-Level Await
// Это приостановит выполнение модуля до загрузки данных.
let serviceAccount;
try {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) {
    throw new Error(
      "Переменная окружения FIREBASE_SERVICE_ACCOUNT не установлена."
    );
  }

  // Парсим строку JSON в объект
  serviceAccount = JSON.parse(serviceAccountJson);

  console.log("✅ Конфигурация Firebase Admin загружена из ENV.");
} catch (error) {
  console.error("❌ Ошибка загрузки firebase-admin-key.json:", error);
  // Здесь можно бросить ошибку, чтобы остановить запуск сервера
  throw new Error("Не удалось загрузить учетные данные Firebase Admin.");
}

// 2. Инициализация Firebase Admin SDK
// Эта инициализация должна произойти только один раз при старте сервера.
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("✅ Firebase Admin SDK успешно инициализирован.");
} catch (error) {
  // Мы игнорируем ошибку, если Firebase уже инициализирован
  if (!/already exists/u.test(error.message)) {
    console.error("❌ Ошибка инициализации Firebase Admin:", error);
  }
}

export async function sendPushNotification(
  recipientToken,
  title,
  body,
  data = {}
) {
  const message = {
    // Секция notification: используется нативными ОС для показа баннера
    notification: {
      title: title,
      body: body,
    },
    // Секция data: передача данных приложению
    data: data,
    token: recipientToken,
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("Успешно отправлено сообщение:", response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error("Ошибка отправки сообщения:", error);

    // Если токен недействителен, он должен быть удален из БД
    if (
      error.code === "messaging/invalid-argument" ||
      error.code === "messaging/registration-token-not-registered"
    ) {
      console.warn(
        `Токен ${recipientToken} невалиден и должен быть удален из БД.`
      );
    }

    return { success: false, error: error.message };
  }
}
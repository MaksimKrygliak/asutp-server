// services/notificationService.js
import admin from "firebase-admin";


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

export async function sendMulticastPush(tokens, title, body, data = {}) {
  // Разбиваем массив токенов на чанки по 500 штук (ограничение Firebase)
  const chunkSize = 500;
  const deadTokens = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < tokens.length; i += chunkSize) {
    const chunk = tokens.slice(i, i + chunkSize);

    const message = {
      notification: { title, body },
      data: data,
      tokens: chunk,
    };

    try {
      // Используем sendEachForMulticast для пакетной отправки
      const response = await admin.messaging().sendEachForMulticast(message);
      successCount += response.successCount;
      failureCount += response.failureCount;

      // Ищем токены, которые больше не работают, чтобы удалить их из БД
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errCode = resp.error?.code;
            if (
              errCode === 'messaging/invalid-registration-token' ||
              errCode === 'messaging/registration-token-not-registered'
            ) {
              deadTokens.push(chunk[idx]);
            }
          }
        });
      }
    } catch (error) {
      console.error("Ошибка при пакетной рассылке (Multicast):", error);
    }
  }

  return { successCount, failureCount, deadTokens };
}
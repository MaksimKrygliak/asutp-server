// utils/driveService.js
import { google } from "googleapis";

// Теперь все конфиги берутся из ENV
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  throw new Error(
    "❌ Отсутствуют переменные окружения GOOGLE_CLIENT_ID/SECRET/URI."
  );
}

export function createOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

// === Получение клиента Drive (теперь использует ENV) ===
export async function getDriveClient() {
  const oAuth2Client = createOAuthClient();

  if (!REFRESH_TOKEN) {
    throw new Error(
      "❌ Переменная GOOGLE_REFRESH_TOKEN не установлена. Сначала авторизуйтесь."
    );
  }

  // Устанавливаем Refresh Token. Google API автоматически сгенерирует
  // новый Access Token при первом запросе и будет его обновлять по необходимости.
  oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

  // Обработчик обновления токена нам больше не нужен,
  // так как Access Token не нужно сохранять, а Refresh Token не меняется.

  const drive = google.drive({ version: "v3", auth: oAuth2Client });

  return { drive, auth: oAuth2Client };
}

// === Первый вход по коду (возвращает токен для ENV)
export async function authorizeOnce(code) {
  const oAuth2Client = createOAuthClient();

  const { tokens } = await oAuth2Client.getToken(code);

  if (tokens.refresh_token) {
    // 🚨 ВАЖНО: Больше НЕ СОХРАНЯЕМ В ФАЙЛ. Выводим токен для ручной установки в ENV.
    console.log("=================================================");
    console.log("✅ АВТОРИЗАЦИЯ УСПЕШНА. СКОПИРУЙТЕ ЭТОТ ТОКЕН:");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(
      "Затем установите его в переменные окружения и перезапустите сервер."
    );
    console.log("=================================================");
    return tokens.refresh_token; // Возвращаем токен для удобства
  } else {
    throw new Error("Не удалось получить Refresh Token.");
  }
}

// === Ссылка для авторизации (использует ENV для конфига)
export function getAuthUrl() {
  const oAuth2Client = createOAuthClient();

  const scopes = ["https://www.googleapis.com/auth/drive"];
  return oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent",
  });
}
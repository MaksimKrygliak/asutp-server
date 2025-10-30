// utils/driveService.js
import { google } from "googleapis";

// Теперь все конфиги берутся из ENV
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN; // Главный секрет

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

// // utils/driveService.js
// import fs from "fs";
// import path from "path";
// import { google } from "googleapis";

// const __dirname = path.resolve();
// const TOKEN_PATH = path.join(__dirname, "token.json");
// const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");

// export async function getDriveClient() {
//   const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
//   const { client_secret, client_id, redirect_uris } = credentials.web;

//   const oAuth2Client = new google.auth.OAuth2(
//     client_id,
//     client_secret,
//     redirect_uris[0]
//   );

//   if (fs.existsSync(TOKEN_PATH)) {
//     const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
//     oAuth2Client.setCredentials(token);

//     // 🌟 ИСПРАВЛЕНИЕ: Автоматическое обновление токена
//     // Принудительно проверяем, нужно ли обновить токен доступа.
//     // Если токен успешно обновляется, мы сохраняем новый набор токенов (с тем же refresh_token)
//     // в token.json, чтобы сохранить новый срок действия Access Token.
//     oAuth2Client.on("tokens", (tokens) => {
//       if (tokens.refresh_token) {
//         // Если мы получаем новый refresh_token (что редко), сохраняем его
//         token.refresh_token = tokens.refresh_token;
//       }
//       token.access_token = tokens.access_token;
//       token.expiry_date = tokens.expiry_date;

//       // Перезаписываем файл, чтобы сохранить обновлённый access_token
//       fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
//       console.log("🔄 Access Token успешно обновлён и сохранён.");
//     });
//   } else {
//     throw new Error("❌ Нет сохранённого токена. Сначала авторизуйся.");
//   }

//   const drive = google.drive({ version: "v3", auth: oAuth2Client });

//   // 👇 Возвращаем и drive, и auth
//   return { drive, auth: oAuth2Client };
// }

// // export async function getDriveClient() {
// //   const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
// //   const { client_secret, client_id, redirect_uris } = credentials.web;

// //   const oAuth2Client = new google.auth.OAuth2(
// //     client_id,
// //     client_secret,
// //     redirect_uris[0]
// //   );

// //   // Проверяем, есть ли сохранённый токен
// //   if (fs.existsSync(TOKEN_PATH)) {
// //     const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
// //     oAuth2Client.setCredentials(token);
// //   } else {
// //     throw new Error("❌ Нет сохранённого токена. Сначала авторизуйся.");
// //   }

// //   return google.drive({ version: "v3", auth: oAuth2Client });
// // }

// // === Первый вход по коду (из браузера)
// export async function authorizeOnce(code) {
//   const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
//   const { client_secret, client_id, redirect_uris } = credentials.web;
//   const oAuth2Client = new google.auth.OAuth2(
//     client_id,
//     client_secret,
//     redirect_uris[0]
//   );

//   const { tokens } = await oAuth2Client.getToken(code);
//   if (tokens.refresh_token) {
//     // ⚠️ СОХРАНИТЬ ЭТОТ ТОКЕН НАВСЕГДА в DB или Secure Config!
//     console.log("Получен токен обновления:", tokens.refresh_token);
//   }
//   oAuth2Client.setCredentials(tokens);

//   fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
//   console.log("✅ Token сохранён в token.json");
// }

// // === Ссылка для авторизации
// export function getAuthUrl() {
//   const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
//   const { client_secret, client_id, redirect_uris } = credentials.web;
//   const oAuth2Client = new google.auth.OAuth2(
//     client_id,
//     client_secret,
//     redirect_uris[0]
//   );

//   const scopes = ["https://www.googleapis.com/auth/drive"];
//   return oAuth2Client.generateAuthUrl({
//     access_type: "offline",
//     scope: scopes,
//     prompt: "consent",
//   });
// }

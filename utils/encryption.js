// // utils/encryption.js
// import crypto from 'crypto';

// const algorithm = 'aes-256-cbc';
// // Ключ берется из .env (должен быть 32 байта)
// const key = process.env.ENCRYPTION_KEY; 
// const ivLength = 16; 

// export const encrypt = (text) => {
//   if (!text) return text;
  
//   try {
//     const iv = crypto.randomBytes(ivLength);
//     const cipher = crypto.createCipheriv(algorithm, Buffer.from(key), iv);
    
//     let encrypted = cipher.update(text);
//     encrypted = Buffer.concat([encrypted, cipher.final()]);
    
//     // Возвращаем IV + Зашифрованный текст через двоеточие
//     return iv.toString('hex') + ':' + encrypted.toString('hex');
//   } catch (error) {
//     console.error("Encryption error:", error);
//     return text; // В случае ошибки вернем как есть, чтобы не потерять данные
//   }
// };

// export const decrypt = (text) => {
//   if (!text) return text;
  
//   try {
//     const textParts = text.split(':');
    
//     // Если формат не "IV:TEXT" (например, старые незашифрованные данные)
//     if (textParts.length !== 2) return text; 
    
//     const iv = Buffer.from(textParts.shift(), 'hex');
//     const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    
//     const decipher = crypto.createDecipheriv(algorithm, Buffer.from(key), iv);
    
//     let decrypted = decipher.update(encryptedText);
//     decrypted = Buffer.concat([decrypted, decipher.final()]);
    
//     return decrypted.toString();
//   } catch (error) {
//     // Если ключ не подошел или данные повреждены
//     console.error("Decryption error:", error);
//     return text; 
//   }
// };
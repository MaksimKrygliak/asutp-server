import { body } from 'express-validator';

export const loginValidation = [
  body('email', 'Неверный формат почты').isEmail(),
  body('password', 'Пароль має бути мінімум 5 символів').isLength({ min: 5 }),
];

export const registerValidation = [
  body('email', 'Неверный формат почты').isEmail(),
  body('password', 'Пароль має бути мінімум 5 символів').isLength({ min: 5 }),
  body('fullName', "Ім'я має бути довшим за три символи").isLength({ min: 3 }),
  body('engineerPosition', "Посада має бути довшою за три символи").isLength({ min: 3 }),
  body('avatarUrl', 'Неправильне посилання на аватарку').optional().isURL()
];

export const postCreateValidation = [
  body('title', 'Введіть заголовок статті (мінімум 3 символи)').isLength({ min: 3 }).isString(),
  body('text', 'Введіть текст статті (мінімум 3 символи)').isLength({ min: 3 }).isString(),
  body('tags', 'Неверный формат тэгов').optional().isString(),
  body('imageUrl', 'Неверная ссылка на изображение').optional().isString(),
];

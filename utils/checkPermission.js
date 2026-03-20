import redis from './redis.js';
import UserModel from '../models/User.js';

export const checkPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      // 1. Админов пускаем всегда
      if (req.userRole === "администратор") {
        return next();
      }

      const redisKey = `user_perms:${req.userId}`;
      let permissions = [];

      // 2. Читаем из Upstash Redis (он сразу вернет массив, если он там есть)
      const cachedPermissions = await redis.get(redisKey);

      if (cachedPermissions) {
        permissions = cachedPermissions;
      } else {
        // 3. Fallback: Если в кэше пусто, идем в MongoDB
        const user = await UserModel.findById(req.userId).select('permissions');
        if (!user) {
          return res.status(404).json({ message: "Користувача не знайдено" });
        }

        permissions = user.permissions || [];
        
        // 4. Сохраняем массив в Redis на 24 часа (86400 секунд)
        // Синтаксис Upstash: redis.set(ключ, значение, { параметры })
        await redis.set(redisKey, permissions, { ex: 86400 });
      }

      // 5. Проверяем наличие нужного права
      if (permissions.includes(requiredPermission)) {
        return next();
      }

      return res.status(403).json({ message: "У вас недостатньо прав доступу" });
    } catch (error) {
      console.error("Ошибка при проверке прав:", error);
      res.status(500).json({ message: "Внутрішня помилка сервера" });
    }
  };
};
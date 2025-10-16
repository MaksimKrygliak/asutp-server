export const verifyRegularRole = (req, res, next) => {
    if (req.userRole === 'звичайний') { // Используем req.userRole
      next();
    } else {
      return res.status(403).json({ message: 'Доступ запрещен. Требуется обычная роль.' });
    }
  };
  
export const verifyAdminRole = (req, res, next) => {
    if (req.userRole === 'адміністратор') { // Используем req.userRole
      next();
    } else {
      return res.status(403).json({ message: 'Доступ запрещен. Требуется роль администратора.' });
    }
  };
import jwt from "jsonwebtoken";

export default (req, res, next) => {
  const token = (req.headers.authorization || "").replace(/Bearer\s?/, "");

  if (token) {
    jwt.verify(token, "secret123", (err, decoded) => {
      if (err) {
        console.error("Ошибка проверки токена:", err.message);
        if (err.name === "TokenExpiredError") {
          return res.status(401).json({ message: "Минув термін придатності токена" });
        }
        return res.status(403).json({ message: "Неправильний токен" });
      }
      req.userId = decoded._id;
      req.userRole = decoded.role;
      next();
    });
  } else {
    return res.status(401).json({ message: "Токен отсутствует" });
  }
};

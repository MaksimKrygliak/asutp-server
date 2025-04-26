import PhoneNumberModel from "../models/PhoneNumber.js";

export const getLastTags = async (req, res) => {
  try {
    const posts = await PhoneNumberModel.find().limit(5).exec();

    const tags = posts
      .map((obj) => obj.tags)
      .flat()
      .slice(0, 5);

    res.json(tags);
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Не удалось получить тэги",
    });
  }
};

export const getAll = async (req, res) => {
  try {
    const { name } = req.query;
    let query = {};

    if (name) {
      query.name = { $regex: name, $options: 'i' }; // Поиск по подстроке, регистронезависимый
    }

    const phoneNumbers = await PhoneNumberModel.find(query).populate("user").exec();
    const totalCount = await PhoneNumberModel.countDocuments(query);
    res.json({
      data: phoneNumbers,
      total: totalCount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Не удалось получить номера телефонов",
    });
  }
};

export const getOne = async (req, res) => {
  try {
    const postId = req.params.id;

    PhoneNumberModel.findOneAndUpdate(
      {
        _id: postId,
      },
      {
        $inc: { viewsCount: 1 },
      },
      {
        returnDocument: "after",
      },
      (err, doc) => {
        if (err) {
          console.log(err);
          return res.status(500).json({
            message: "Не удалось вернуть статью",
          });
        }

        if (!doc) {
          return res.status(404).json({
            message: "Статья не найдена",
          });
        }

        res.json(doc);
      }
    ).populate("user");
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Не удалось получить статьи",
    });
  }
};

export const remove = async (req, res) => {
  try {
    const phoneNumberId = req.params.id;

    const deletedPhoneNumber = await PhoneNumberModel.findByIdAndDelete(phoneNumberId);

    if (!deletedPhoneNumber) {
      return res.status(404).json({ message: "Номер телефона не найден" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Не удалось удалить номер телефона" });
  }
};

export const create = async (req, res) => {
  try {
    const { name, text } = req.body; // Получаем имя из тела запроса

    const doc = new PhoneNumberModel({
      name: name,
      text: text,
      user: req.userId,
    });

    const phoneNumber = await doc.save();

    res.json(phoneNumber);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Не удалось создать номер телефона",
    });
  }
};

export const update = async (req, res) => {
  try {
    const phoneNumberId = req.params.id;
    const { name, text } = req.body;

    const updatedPhoneNumber = await PhoneNumberModel.findByIdAndUpdate(
      phoneNumberId,
      { name, text },
      { new: true } // Возвращает обновленный документ
    );

    if (!updatedPhoneNumber) {
      return res.status(404).json({ message: "Номер телефона не найден" });
    }

    res.json(updatedPhoneNumber);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Не удалось обновить номер телефона" });
  }
};

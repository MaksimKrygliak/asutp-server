import PostModel from "../models/Post.js";
import User from "../models/User.js";

export const getLastTags = async (req, res) => {
  try {
    const posts = await PostModel.find().limit(5).exec();

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
    const tag = req.query.tag;
    let query = {};
    if (tag) {
      query.tags = tag;
    }

    const [notes, count] = await Promise.all([
      PostModel.find(query).populate("user").exec(),
      PostModel.countDocuments(query),
    ]);

    res.json({ notes, count });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Не удалось получить статьи",
    });
  }
};

export const getOne = async (req, res) => {
  try {
    const postId = req.params.id;

    PostModel.findOneAndUpdate(
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
    const postId = req.params.id;
    const userId = req.userId; // ID текущего пользователя из middleware checkAuth
    const userRole = req.userRole; // Роль текущего пользователя

    const post = await PostModel.findById(postId).populate("user");

    if (!post) {
      return res.status(404).json({ message: "Стаття не знайдена" });
    }

    console.log("UserID текущего пользователя:", userId);
    console.log("ID автора поста:", post.user._id.toString());
    console.log("Роль текущего пользователя:", userRole);

    // Разрешаем удаление, если пользователь - администратор ИЛИ автор поста
    if (userRole === "адміністратор" || post.user._id.toString() === userId) {
      PostModel.findOneAndDelete({ _id: postId }, (err, doc) => {
        if (err) {
          console.error(err);
          return res
            .status(500)
            .json({ message: "Не вдалося видалити статтю" });
        }
        if (!doc) {
          return res.status(404).json({ message: "Стаття не знайдена" });
        }
        res.json({ success: true });
      });
    } else {
      return res
        .status(403)
        .json({ message: "Ви не маєте прав для видалення цієї статті" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Не вдалося отримати статті" });
  }
};

export const create = async (req, res) => {
  try {
    const { title, text, imageUrl, tags, type, resolved } = req.body;
    const userId = req.userId;

    const postData = {
      title,
      text,
      imageUrl,
      tags: tags.split(","),
      user: userId,
      type: type,
      // resolved:type === "аварійна" ? resolved : false, // Ensure correct value
    };

    if (type === "аварійна") {
      postData.resolved = false;
    }
    console.log(PostModel.Model);
    const doc = new PostModel(postData);
    const post = await doc.save();

    res.json(post);
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Не удалось создать статью",
    });
  }
};

export const update = async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.userId;
    const userRole = req.userRole;

    const post = await PostModel.findById(postId).populate("user");

    if (!post) {
      return res.status(404).json({ message: "Стаття не знайдена" });
    }

    if (userRole === "адміністратор" || post.user._id.toString() === userId) {
      const updateData = {};
      if (req.body.hasOwnProperty("resolved")) {
        updateData.resolved = req.body.resolved;
      }
      if (req.body.hasOwnProperty("title")) {
        updateData.title = req.body.title;
      }
      if (req.body.hasOwnProperty("text")) {
        updateData.text = req.body.text;
      }
      if (req.body.hasOwnProperty("imageUrl")) {
        updateData.imageUrl = req.body.imageUrl;
      }
      if (req.body.hasOwnProperty("tags")) {
        updateData.tags = req.body.tags.split(",");
      }

      if (Object.keys(updateData).length === 0) {
        return res
          .status(400)
          .json({ message: "Не надано жодних даних для оновлення" });
      }

      await PostModel.updateOne({ _id: postId }, { $set: updateData });

      // Знайдіть оновлену статтю та знову підтягніть інформацію про користувача
      const updatedPost = await PostModel.findById(postId).populate("user");

      res.json({
        success: true,
        message: "Статтю успішно оновлено",
        data: updatedPost, // Тепер data міститиме повний об'єкт користувача
      });
    } else {
      return res
        .status(403)
        .json({ message: "Ви не маєте прав для редагування цієї статті" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Не вдалося обновити статтю" });
  }
};

export const markPostAsViewed = async (req, res) => {
  const { id: postId } = req.params;
  const userId = req.userId; // Припускаємо, що ви маєте ID користувача з middleware
  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { $addToSet: { viewedPosts: postId } }, // Додаємо ID поста до масиву переглянутих постів (якщо його там ще немає)
      { new: true }
    );
    console.log(user)
    if (!user) {
      return res.status(404).json({ message: 'Користувача не знайдено' });
    }

    res.json({ success: true, message: 'Нотатку позначено як переглянуту' });
  } catch (error) {
    console.error('Помилка при позначенні поста як переглянутого:', error);
    res.status(500).json({ message: 'Не вдалося позначити нотатку як переглянуту' });
  }
};

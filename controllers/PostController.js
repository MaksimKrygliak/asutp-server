import PostModel from "../models/Post.js";

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

    const post = await PostModel.findById(postId).populate('user');

    if (!post) {
      return res.status(404).json({ message: 'Стаття не знайдена' });
    }

    console.log('UserID текущего пользователя:', userId);
    console.log('ID автора поста:', post.user._id.toString());
    console.log('Роль текущего пользователя:', userRole);

    // Разрешаем удаление, если пользователь - администратор ИЛИ автор поста
    if (userRole === 'адміністратор' || post.user._id.toString() === userId) {
      PostModel.findOneAndDelete(
        { _id: postId },
        (err, doc) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Не вдалося видалити статтю' });
          }
          if (!doc) {
            return res.status(404).json({ message: 'Стаття не знайдена' });
          }
          res.json({ success: true });
        }
      );
    } else {
      return res.status(403).json({ message: 'Ви не маєте прав для видалення цієї статті' });
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Не вдалося отримати статті' });
  }
};

export const create = async (req, res) => {
  try {
    const doc = new PostModel({
      title: req.body.title,
      text: req.body.text,
      imageUrl: req.body.imageUrl,
      tags: req.body.tags.split(","),
      user: req.userId,
    });

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
    const userId = req.userId; // ID текущего пользователя
    const userRole = req.userRole; // Роль текущего пользователя

    const post = await PostModel.findById(postId).populate('user');

    if (!post) {
      return res.status(404).json({ message: 'Стаття не знайдена' });
    }

    console.log('UserID текущего пользователя:', userId);
    console.log('ID автора поста:', post.user._id.toString());
    console.log('Роль текущего пользователя:', userRole);

    // Разрешаем обновление, если пользователь - администратор ИЛИ автор поста
    if (userRole === 'адміністратор' || post.user._id.toString() === userId) {
      await PostModel.updateOne(
        { _id: postId },
        {
          title: req.body.title,
          text: req.body.text,
          imageUrl: req.body.imageUrl,
          user: req.userId, // Возможно, не стоит разрешать менять автора
          tags: req.body.tags ? req.body.tags.split(',') : [],
        }
      );

      res.json({ success: true });
    } else {
      return res.status(403).json({ message: 'Ви не маєте прав для редагування цієї статті' });
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Не вдалося обновить статтю' });
  }
};

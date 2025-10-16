import PostModel from "../models/Post.js";
import User from "../models/User.js";
import mongoose from "mongoose";

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

export const deletePost = async (req, res) => {
  try {
    const postId = req.params.id;
    const post = await PostModel.findByIdAndUpdate(
      postId,
      { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() }, // Обновляем даты
      { new: true } // Возвращаем обновленный документ
    );

    if (!post) {
      return res.status(404).json({ message: "Пост не найден." });
    }
    res.status(200).json({ message: "Пост успешно помечен как удаленный." });
  } catch (error) {
    console.error("Ошибка при мягком удалении поста:", error);
    res.status(500).json({ message: "Ошибка сервера." });
  }
};

export const create = async (req, res) => {
  try {
    const { title, text, imageUrl, tags, type, pech, resolved } = req.body;
    const userId = req.userId;

    const postData = {
      title,
      pech,
      text,
      imageUrl,
      tags: tags.split(","),
      user: userId,
      type: type,
      viewedByUsers: viewedByUsers,
    };

    if (type === "аварійна") {
      postData.resolved = false;
    }
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

export const markPostAsViewed = async (req, res) => {
  const { id: postId } = req.params;
  const userId = req.userId; // Припускаємо, що ви маєте ID користувача з middleware
  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { $addToSet: { viewedPosts: postId } }, // Додаємо ID поста до масиву переглянутих постів (якщо його там ще немає)
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ message: "Користувача не знайдено" });
    }

    res.json({ success: true, message: "Нотатку позначено як переглянуту" });
  } catch (error) {
    console.error("Помилка при позначенні поста як переглянутого:", error);
    res
      .status(500)
      .json({ message: "Не вдалося позначити нотатку як переглянуту" });
  }
};

export const getChanges = async (req, res) => {
  try {
    const since = req.query.since
      ? new Date(req.query.since)
      : console.log("since не получен");
    
    const createdOrUpdatedPosts = await PostModel.find({
      $or: [
        { updatedAt: { $gte: since }, isDeleted: false }, // Обновленные и не удаленные
        { createdAt: { $gte: since }, isDeleted: false }, // Вновь созданные и не удаленные
      ],
    })
      .populate("user") // Если поле 'user' это ObjectId и вы хотите подтянуть данные пользователя
      .lean() // Преобразует Mongoose-документы в простые JavaScript-объекты для чистоты
      .exec();

    // Збираємо всі унікальні ID користувачів з отриманих постів
    const allUserIdsInChanges = new Set();
    createdOrUpdatedPosts.forEach((post) => {
      if (post.user && post.user._id) {
        allUserIdsInChanges.add(post.user._id.toString());
      }
      if (Array.isArray(post.viewedByUsers)) {
        post.viewedByUsers.forEach((userId) => {
          allUserIdsInChanges.add(userId.toString());
        });
      }
    });

    // Завантажуємо інформацію про цих користувачів
    const referencedUsers = await User.find(
      { _id: { $in: Array.from(allUserIdsInChanges) } },
      "fullName" // Повертаємо тільки fullName та _id
    ).lean();

    // --- Запрос для ID постов, которые были УДАЛЕНЫ ---
    // Нам нужны _id постов, у которых:
    // a) isDeleted = true (они помечены как удаленные)
    // b) deletedAt >= since (они были удалены после последней синхронизации клиента)
    //    ИЛИ updatedAt >= since (если вы не используете deletedAt, а просто обновляете updatedAt при isDeleted = true)
    const deletedPostIds = await PostModel.find(
      {
        isDeleted: true,
        deletedAt: { $gte: since }, // Используем deletedAt, если оно у вас есть.
        // Если нет, можно попробовать: updatedAt: { $gte: since }
      },
      "_id"
    ) // Проекция: возвращаем только поле _id
      .lean()
      .exec()
      .then((docs) => docs.map((doc) => doc._id.toString())); // Преобразуем ObjectId в строки

    // 3. Получаем текущую метку времени сервера
    const serverCurrentTimestamp = new Date().toISOString();
    // const userData = {
    //   referencedUsers: referencedUsers.
    // }
    // 4. Отправляем ответ клиенту
    res.json({
      createdOrUpdatedPosts,
      deletedPostIds,
      serverCurrentTimestamp,
      referencedUsers,
    });
  } catch (err) {
    console.error("Server: Ошибка в контроллере getChanges:", err);
    res.status(500).json({
      message: "Не удалось получить изменения.",
      error: err.message, // Для отладки на клиенте
    });
  }
};

export const batchCreate = async (req, res) => {
  const userId = req.userId;
  const arrNotes = Array.isArray(req.body) ? req.body : [];
  const postsToInsert = [];
  const validationResults = [];

  if (arrNotes.length === 0) {
    console.log("Batch Create: Тело запроса пусто или не является массивом.");
    return res.json([]);
  }
  // 1. Валидация и Преобразование входных данных
  arrNotes.forEach((itemData, index) => {
    const __localId = itemData?.__localId;

    if (!itemData || typeof itemData !== "object" || !__localId) {
      console.log(
        "Batch Create: Пропущен элемент из-за неправильного формата или отсутствия __localId:",
        itemData
      );
      validationResults.push({
        __localId: __localId || `index-${index}`,
        success: false,
        error: "Неверный формат или отсутствует __localId",
      });
      return;
    }

    try {
      // 🔥 Исправленный код:
      // Добавляем в postsToInsert, а в validationResults добавляем временную запись
      postsToInsert.push(itemData);
      validationResults.push({
        __localId: __localId,
        success: null, // Устанавливаем null или undefined, чтобы показать, что результат еще не известен
        error: null,
      });
    } catch (transformError) {
      console.error(
        `Batch Create: Ошибка преобразования данных для элемента ${__localId}:`,
        transformError
      );
      validationResults.push({
        __localId: __localId,
        success: false,
        error: `Data transformation failed: ${transformError.message}`,
      });
    }
  });

  if (postsToInsert.length === 0) {
    console.log(
      "Batch Create: Нет валидных элементов для вставки после обработки."
    );
    // Возвращаем результаты валидации, если нечего вставлять
    return res.status(200).json({
      successNewDocs: [],
      failedNewDocs: validationResults.filter((r) => !r.success),
    });
  }

  // 2. Выполнение пакетной вставки в MongoDB
  try {
    const insertResult = await PostModel.insertMany(postsToInsert, {
      ordered: false, // Продолжаем вставлять другие документы, даже если один провалился
    });

    insertResult.forEach((insertedDoc) => {
      const __localId = insertedDoc.__localId;

      if (__localId) {

        // const resultEntry = validationResults.find(
        //   (r) => r.__localId === __localId
        // );
        const resultEntry = validationResults.find((r) => {
          if (insertedDoc.__localId && r.__localId) {
            // Сравниваем ObjectId с строкой с помощью .equals()
            return insertedDoc.__localId.equals(r.__localId);
          }
          return false;
        });

        if (resultEntry) {
          resultEntry.success = true;
          resultEntry.error = null; // Очищаем ошибку "Processing..."
          resultEntry.serverId = insertedDoc._id; // Важно: serverId от MongoDB
          resultEntry.updatedAt = insertedDoc.updatedAt;
        }
      }
    });

    // Отфильтруйте успешные и неуспешные элементы для ответа клиенту
    const successNewDocs = validationResults
      .filter((r) => r.success)
      .map((r) => ({
        __localId: r.__localId,
        _id: r.serverId,
        updatedAt: r.updatedAt,
      }));

    const failedNewDocs = validationResults
      .filter((r) => !r.success)
      .map((r) => ({
        __localId: r.__localId,
        message: r.error,
      }));

    return res.status(200).json({ successNewDocs, failedNewDocs });
  } catch (error) {
    // В случае MongoBulkWriteError (если ordered: false и есть ошибки),
    // error.insertedDocs будет содержать успешно вставленные, а error.writeErrors - проваленные.

    console.error("Batch Create: Ошибка при пакетной вставке:", error);

    // Сначала помечаем все, что еще "Processing...", как проваленные с общей ошибкой
    validationResults.forEach((r) => {
      if (r.error === "Processing...") {
        r.success = false;
        r.error = error.message || "Batch insertion failed";
      }
    });

    // Обновляем результаты для документов, которые *были* успешно вставлены (несмотря на другие ошибки)
    if (error.insertedDocs && Array.isArray(error.insertedDocs)) {
      error.insertedDocs.forEach((insertedDoc) => {
        const __localId = insertedDoc.__localId;
        if (__localId) {
          const resultEntry = validationResults.find(
            (r) => r.__localId === __localId
          );
          if (resultEntry) {
            resultEntry.success = true;
            resultEntry.error = undefined;
            resultEntry.serverId = insertedDoc._id;
            resultEntry.updatedAt = insertedDoc.updatedAt;
          }
        }
      });
    }

    // Обновляем результаты для документов, которые провалились из-за конкретных writeErrors
    if (error.writeErrors && Array.isArray(error.writeErrors)) {
      error.writeErrors.forEach((writeError) => {
        const failedItemIndex = writeError.index;
        if (
          failedItemIndex !== undefined &&
          failedItemIndex < postsToInsert.length
        ) {
          const failedItemData = postsToInsert[failedItemIndex];
          const __localId = failedItemData.__localId;
          const resultEntry = validationResults.find(
            (r) => r.__localId === __localId
          );

          if (resultEntry) {
            resultEntry.success = false;
            resultEntry.error = writeError.errmsg || "Insertion failed";
            resultEntry.serverId = undefined;
            resultEntry.updatedAt = undefined;
          }
        }
      });
    }

    // Формируем финальный ответ клиенту
    const successNewDocs = validationResults
      .filter((r) => r.success)
      .map((r) => ({
        __localId: r.__localId,
        _id: r.serverId,
        updatedAt: r.updatedAt,
      }));
    const failedNewDocs = validationResults
      .filter((r) => !r.success)
      .map((r) => ({
        __localId: r.__localId,
        message: r.error,
      }));

    // Возвращаем 200 OK, даже если есть failedNewDocs, чтобы клиент мог их обработать.
    // Или 207 Multi-Status, если вы хотите явно указать на частичный успех/неудачу.
    return res.status(200).json({ successNewDocs, failedNewDocs });
  }
};

export const batchUpdatePosts = async (req, res) => {
  const updates = req.body; // Ожидаем массив объектов обновлений
  if (!Array.isArray(updates) || updates.length === 0) {
    return res
      .status(400)
      .json({ message: "Updates must be a non-empty array of post objects." });
  }

  const successUpdates = [];
  const failedUpdates = [];

  for (const postUpdate of updates) {
    const { _id, __localId, ...dataToUpdate } = postUpdate; // _id - это server_id, __localId - это локальный ID из Realm

    // Проверка наличия _id (server_id)
    if (!_id) {
      failedUpdates.push({
        __localId,
        message: "Missing server_id (_id) for update.",
      });
      continue;
    }

    // Валидация ObjectId
    if (!mongoose.Types.ObjectId.isValid(_id)) {
      failedUpdates.push({
        __localId,
        _id,
        message: "Invalid server_id (_id) format.",
      });
      continue;
    }

    try {
      const updatedPost = await PostModel.findByIdAndUpdate(
        _id,
        {
          ...dataToUpdate,
          updatedAt: new Date(), // Обновляем дату последнего изменения на сервере
        },
        { new: true, runValidators: true } // Возвращаем обновленный документ и запускаем валидаторы схемы
      );

      if (updatedPost) {
        successUpdates.push({
          __localId: __localId, // Отправляем обратно локальный ID для сопоставления
          _id: updatedPost._id.toString(), // Server ID
          updatedAt: updatedPost.updatedAt,
          // Можно вернуть другие важные поля, если необходимо
        });
      } else {
        failedUpdates.push({
          __localId,
          _id,
          message: "Post not found on server.",
        });
      }
    } catch (error) {
      console.error(`Batch Update: Ошибка обновления поста ${_id}:`, error);
      failedUpdates.push({
        __localId,
        _id,
        message: error.message || "Server error during update.",
      });
    }
  }

  // Возвращаем результаты пакетного обновления
  if (failedUpdates.length > 0) {
    console.warn(
      `Batch Update: Завершено с ошибками. Успешно: ${successUpdates.length}, Ошибки: ${failedUpdates.length}`
    );
    return res.status(207).json({
      // 207 Multi-Status для частичного успеха/неудачи
      message: "Batch update completed with some failures.",
      successUpdates,
      failedUpdates,
    });
  } else {
    console.log(
      `Batch Update: Все ${successUpdates.length} постов успешно обновлены.`
    );
    return res.status(200).json({
      message: "All posts successfully updated.",
      successUpdates,
    });
  }
};

export const batchDeletePosts = async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "IDs повинен бути массивом" });
  }

  const successIds = [];
  const failedIds = [];

  const objectIdsToSoftDelete = ids
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (objectIdsToSoftDelete.length === 0) {
    return res
      .status(400)
      .json({ message: "No valid Object IDs provided for soft deletion." });
  }

  try {
    const result = await PostModel.updateMany(
      {
        _id: { $in: objectIdsToSoftDelete },
        isDeleted: false,
      },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount > 0) {
      objectIdsToSoftDelete.forEach((id) => successIds.push(id.toString()));
    } else {
      objectIdsToSoftDelete.forEach((id) => failedIds.push(id.toString()));
    }

    if (failedIds.length > 0) {
      return res.status(207).json({
        message:
          "Batch soft deletion completed with some failures (or already deleted).",
        successIds,
        failedIds,
      });
    } else {
      return res.status(200).json({
        success: true,
        message: `Successfully soft deleted ${result.modifiedCount} posts.`,
        successIds,
      });
    }
  } catch (error) {
    console.error("Ошибка при пакетном мягком удалении постов:", error);
    return res
      .status(500)
      .json({ message: "Ошибка сервера при пакетном мягком удалении постов." });
  }
};

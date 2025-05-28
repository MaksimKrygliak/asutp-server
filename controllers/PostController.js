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
    const { title, text, imageUrl, tags, type, resolved } = req.body;
    const userId = req.userId;

    const postData = {
      title,
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
    // 1. Получаем дату последней синхронизации от клиента.
    // Если 'since' не передан (первая синхронизация), используем начало эпохи.
    const since = req.query.since ? new Date(req.query.since) : new Date(0);
    // --- Запрос для постов, которые были СОЗДАНЫ ИЛИ ОБНОВЛЕНЫ ---
    // Нам нужны посты, у которых:
    // a) updatedAt >= since ИЛИ createdAt >= since (чтобы поймать новые и обновленные)
    // b) isDeleted = false (мы не хотим возвращать удаленные посты как "обновленные")
    const createdOrUpdatedPosts = await PostModel.find({
      $or: [
        { updatedAt: { $gte: since }, isDeleted: false }, // Обновленные и не удаленные
        { createdAt: { $gte: since }, isDeleted: false }, // Вновь созданные и не удаленные
      ],
    })
      .populate("user") // Если поле 'user' это ObjectId и вы хотите подтянуть данные пользователя
      .lean() // Преобразует Mongoose-документы в простые JavaScript-объекты для чистоты
      .exec();

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

    // 4. Отправляем ответ клиенту
    res.json({
      createdOrUpdatedPosts,
      deletedPostIds,
      serverCurrentTimestamp,
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
  const itemsToProcess = Array.isArray(req.body) ? req.body : [];

  const postsToInsert = [];
  const finalResults = []; // Масив для зберігання результатів для кожного клієнтського елемента

  console.log(`Batch Create: Отримано ${itemsToProcess.length} елементів.`);

  if (itemsToProcess.length === 0) {
    console.log("Batch Create: Тіло запиту пусте або не є масивом.");
    return res.json([]);
  }

  // 1. Валідація та Перетворення вхідних даних
  itemsToProcess.forEach((itemData, index) => {
    const localId = itemData?.__localId;

    if (!itemData || typeof itemData !== "object" || !localId) {
      console.warn(
        "Batch Create: Пропущено елемент через неправильний формат або відсутність localId:",
        itemData
      );
      finalResults.push({
        localId: localId || `index-${index}`,
        success: false,
        error: "Invalid item format or missing localId",
      });
      return;
    }

    if (!itemData.title || !itemData.text) {
      console.warn(
        `Batch Create: Пропущено елемент ${localId} через відсутність обов'язкових полів (title або text).`,
        itemData
      );
      finalResults.push({
        localId: localId,
        success: false,
        error: "Missing required fields (title or text)",
      });
      return;
    }

    try {
      const tagsArray = Array.isArray(itemData.tags)
        ? itemData.tags
            .map((tag) => String(tag).trim())
            .filter((tag) => tag.length > 0)
        : [];

      const postDocData = {
        __localId: itemData.__localId,
        title: itemData.title,
        text: itemData.text,
        tags: tagsArray,
        user: userId,
        type: itemData.type || "інформаційна",
        resolved: null, // Початкове значення
        imageUrl: itemData.imageUrl || null,
        viewedByUsers: itemData.viewedByUsers
        // createdAt та updatedAt будуть встановлені Mongoose, якщо у схемі є timestamps: true
        // Якщо їх тут явно встановити, Mongoose їх ПЕРЕПИШЕ при збереженні.
        // Тому краще їх тут не вказувати, якщо ви покладаєтесь на timestamps: true
      };

      if (itemData.type === "аварійна") {
        postDocData.resolved = false;
      } else {
        // Якщо тип не "аварійна", і resolved присутній у вхідних даних, використовуємо його.
        // В іншому випадку, за замовчуванням false.
        postDocData.resolved =
          itemData.resolved !== undefined ? itemData.resolved : false;
      }

      postsToInsert.push(postDocData);
      // Додаємо попередній запис у результати для елементів, які пішли на вставку
      // Його статус буде оновлено пізніше.
      finalResults.push({
        localId: localId,
        success: false,
        error: "Processing...",
      });
    } catch (transformError) {
      console.error(
        `Batch Create: Помилка перетворення даних для елемента ${localId}:`,
        transformError
      );
      finalResults.push({
        localId: localId,
        success: false,
        error: `Data transformation failed: ${transformError.message}`,
      });
    }
  });

  if (postsToInsert.length === 0) {
    console.log(
      "Batch Create: Немає валідних елементів для вставки після обробки."
    );
    return res.json(finalResults);
  }

  // 2. Виконання пакетної вставки в MongoDB (ТІЛЬКИ ОДИН РАЗ)
  try {
    const insertResult = await PostModel.insertMany(postsToInsert, {
      ordered: false,
    });

    // Лог показує, що insertResult є масивом документів.
    // Перевіримо це явно.
    let nInsertedCount = 0;
    let successfullyInsertedDocs = [];

    if (Array.isArray(insertResult)) {
      // Якщо insertResult є масивом (новий Mongoose / драйвер)
      nInsertedCount = insertResult.length;
      successfullyInsertedDocs = insertResult;
    } else if (
      insertResult &&
      insertResult.result &&
      typeof insertResult.result.nInserted === "number"
    ) {
      // Якщо insertResult є BulkWriteResult об'єктом зі старою структурою
      nInsertedCount = insertResult.result.nInserted;
      // У цьому випадку, успішні документи можуть бути в insertResult.ops
      // або ж їх потрібно буде отримувати за insertResult.insertedIds
      successfullyInsertedDocs = insertResult.ops || []; // insertResult.ops може бути присутнім
    } else {
      // Неочікуваний формат результату
      console.warn(
        "Batch Create: Неочікуваний формат результату insertMany:",
        insertResult
      );
    }

    // Оновлюємо результати на основі успішних вставок
    if (nInsertedCount > 0) {
      successfullyInsertedDocs.forEach((insertedDoc) => {
        const localId = insertedDoc.__localId;
        if (localId) {
          const resultEntry = finalResults.find((r) => r.localId === localId);
          if (resultEntry) {
            resultEntry.success = true;
            resultEntry.error = undefined;
            resultEntry.serverId = insertedDoc._id;
            resultEntry.updatedAt = insertedDoc.updatedAt; // Використовуємо updatedAt, якщо є
          } else {
            console.warn(
              "Batch Create: Не знайдено початкового запису в результатах для успішної вставки:",
              localId,
              insertedDoc
            );
            finalResults.push({
              localId: localId,
              success: true,
              serverId: insertedDoc._id,
              updatedAt: insertedDoc.updatedAt,
              warning: "Result mapping issue",
            });
          }
        }
      });
    } else {
      console.log(
        `Batch Create: No documents successfully inserted (0 inserted).`
      );
    }

    console.log(
      `Batch Create: Успішно вставлено ${nInsertedCount} документів.`
    );
    return res.json(finalResults);
  } catch (error) {
    console.error("Batch Create: Помилка під час insertMany:", error);

    // Обробка error.insertedDocs та error.writeErrors залишається такою ж,
    // оскільки об'єкт помилки (MongoBulkWriteError) має ці властивості.

    // Оновлюємо результати для елементів, які були успішно вставлені (якщо такі є в error.insertedDocs)
    if (error.insertedDocs && Array.isArray(error.insertedDocs)) {
      error.insertedDocs.forEach((insertedDoc) => {
        const localId = insertedDoc.__localId;
        if (localId) {
          const resultEntry = finalResults.find((r) => r.localId === localId);
          if (resultEntry) {
            resultEntry.success = true;
            resultEntry.error = undefined;
            resultEntry.serverId = insertedDoc._id;
            resultEntry.updatedAt = insertedDoc.updatedAt;
          } else {
            console.warn(
              "Batch Create: Не знайдено початкового запису в результатах для успішної вставки (в catch):",
              localId,
              insertedDoc
            );
            finalResults.push({
              localId: localId,
              success: true,
              serverId: insertedDoc._id,
              updatedAt: insertedDoc.updatedAt,
              warning: "Result mapping issue in catch",
            });
          }
        }
      });
    }

    // Обробляємо помилки для окремих елементів (якщо є writeErrors)
    if (error.writeErrors && Array.isArray(error.writeErrors)) {
      error.writeErrors.forEach((writeError) => {
        const failedItemIndex = writeError.index;
        if (
          failedItemIndex !== undefined &&
          failedItemIndex < postsToInsert.length
        ) {
          const failedItemData = postsToInsert[failedItemIndex];
          const localId = failedItemData.__localId;

          if (localId) {
            const resultEntry = finalResults.find((r) => r.localId === localId);
            if (resultEntry) {
              resultEntry.success = false;
              resultEntry.error = writeError.errmsg || "Insertion failed";
              resultEntry.serverId = undefined;
              resultEntry.updatedAt = undefined;
            } else {
              console.warn(
                "Batch Create: Не знайдено початкового запису в результатах для елемента з writeError:",
                localId,
                writeError
              );
              finalResults.push({
                localId: localId,
                success: false,
                error:
                  writeError.errmsg || "Insertion failed (no initial entry)",
              });
            }
          } else {
            console.warn(
              "Batch Create: Елемент з writeError не має localId після перетворення:",
              failedItemData,
              writeError
            );
            finalResults.push({
              success: false,
              error: `Insertion failed at index ${failedItemIndex}: ${
                writeError.errmsg || "Unknown error"
              }`,
            });
          }
        }
      });
    } else {
      // Загальна помилка
      console.error("Batch Create: Загальна помилка insertMany:", error);
      postsToInsert.forEach((item) => {
        const localId = item.__localId;
        if (localId) {
          const resultEntry = finalResults.find((r) => r.localId === localId);
          if (
            resultEntry &&
            resultEntry.success === false &&
            resultEntry.error === "Processing..."
          ) {
            resultEntry.error = error.message || "Batch insertion failed";
          } else if (!resultEntry) {
            finalResults.push({
              localId: localId,
              success: false,
              error:
                error.message ||
                "Batch processing failed (missing initial entry)",
            });
          }
        }
      });
    }

    return res.status(500).json(finalResults);
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
      // Здесь можно добавить проверку прав доступа (например, только владелец поста может его обновить)
      // В данном примере, просто ищем и обновляем.
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
  console.log("Batch Delete: Получен запрос на пакетное удаление постов.");
  const { ids } = req.body; // Ожидаем массив ID для удаления

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "IDs must be a non-empty array." });
  }

  const successIds = [];
  const failedIds = [];

  // Преобразуем строковые ID в ObjectId и фильтруем невалидные
  const objectIdsToDelete = ids
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (objectIdsToDelete.length === 0) {
    return res
      .status(400)
      .json({ message: "No valid Object IDs provided for deletion." });
  }

  try {
    // Опционально: Проверка прав доступа.
    // Вы можете получить посты по ID и проверить, что req.user._id является владельцем или администратором.
    // const postsToDelete = await PostModel.find({ _id: { $in: objectIdsToDelete } });
    // const authorizedPostIds = postsToDelete.filter(post => post.user.toString() === req.user._id.toString()).map(post => post._id);
    // const unauthorizedIds = objectIdsToDelete.filter(id => !authorizedPostIds.some(authId => authId.equals(id)));
    // if (unauthorizedIds.length > 0) {
    //     failedIds.push(...unauthorizedIds.map(id => ({ _id: id.toString(), message: 'Not authorized to delete this post.' })));
    //     objectIdsToDelete = authorizedPostIds; // Удаляем только те, на которые есть права
    // }

    const result = await PostModel.deleteMany({
      _id: { $in: objectIdsToDelete },
    });

    if (result.deletedCount > 0) {
      // Для простоты, считаем все запрошенные валидные ID успешно удаленными
      // В более сложной логике, можно проверять каждый ID по result.deletedCount
      // или использовать `bulkWrite` для более детального отчета
      objectIdsToDelete.forEach((id) => successIds.push(id.toString()));
    }

    console.log(
      `Batch Delete: Запрошено ${ids.length} ID, удалено ${result.deletedCount} постов.`
    );

    if (failedIds.length > 0) {
      // Если были ошибки авторизации или другие
      return res.status(207).json({
        // 207 Multi-Status
        message: "Batch deletion completed with some failures.",
        successIds,
        failedIds,
      });
    } else {
      return res.status(200).json({
        success: true,
        message: `Successfully deleted ${result.deletedCount} posts.`,
        successIds,
      });
    }
  } catch (error) {
    console.error("Ошибка при пакетном удалении постов:", error);
    return res
      .status(500)
      .json({ message: "Ошибка сервера при пакетном удалении постов." });
  }
};
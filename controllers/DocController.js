import DocModel from "../models/Doc.js";
import mongoose from "mongoose";
import User from "../models/User.js";
import { DateTime } from "luxon";

export const batchCreate = async (req, res) => {
  const itemsToProcess = Array.isArray(req.body) ? req.body : [];
  const docsToInsert = [];
  const initialClientResultsMap = new Map();

  const successNewDocs = [];
  const failedNewDocs = [];

  if (itemsToProcess.length === 0) {
    console.log("Batch Create: Тело запроса пустое или не является массивом.");
    return res.json({ successNewDocs: [], failedNewDocs: [] });
  }

  // 1. Предварительная обработка и валидация входящих данных
  itemsToProcess.forEach((itemData) => {
    let localIdStr;
    let UserIdStr;
    try {
      if (itemData?.__localId && itemData?.user) {
        if (
          mongoose.Types.ObjectId.isValid(itemData.__localId) &&
          mongoose.Types.ObjectId.isValid(itemData.user)
        ) {
          localIdStr = itemData.__localId;
          UserIdStr = itemData.user;
        } else {
          throw new Error(
            `Неверный формат __localId: ${itemData.__localId} или user: ${itemData.user}`
          );
        }
      } else {
        throw new Error("Отсутствует __localId или user");
      }
    } catch (e) {
      const errorEntry = {
        __localId: itemData?.__localId || "unknown",
        user: itemData?.user || "unknown",
        message: `Ошибка валидации: ${e.message}`,
      };
      failedNewDocs.push(errorEntry);
      return; // Пропускаем этот элемент, если валидация не удалась
    }

    try {
      const documentsArray = Array.isArray(itemData.documents)
        ? itemData.documents.map((subDoc) => ({
            equipment: subDoc.equipment,
            Path: subDoc.Path,
            Name: subDoc.Name,
            Page: subDoc.Page,
            NameImg: subDoc.NameImg,
          }))
        : [];

      const DocData = {
        __localId: new mongoose.Types.ObjectId(localIdStr), // Сохраняем как ObjectId в MongoDB
        idDoc: itemData.idDoc,
        pech: itemData.pech,
        location: itemData.location,
        Enclosure: itemData.Enclosure,
        description: itemData.description,
        isPendingDeletion: itemData.isPendingDeletion || false,
        user: new mongoose.Types.ObjectId(UserIdStr),
        documents: documentsArray,
        // createdAt: itemData.createdAt
        //   ? new Date(itemData.createdAt)
        //   : new Date(),
        // updatedAt: itemData.updatedAt
        //   ? new Date(itemData.updatedAt)
        //   : new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        synced: true, // Помечаем как синхронизированный на сервере
        syncError: null,
      };

      docsToInsert.push(DocData);
      // Инициализируем запись в карте с pending-статусом
      initialClientResultsMap.set(localIdStr, {
        __localId: localIdStr,
        _id: null, // Будет заполнен при успешной вставке
        createdAt: null,
        updatedAt: null,
        message: "Processing...", // Временное сообщение
      });
    } catch (transformError) {
      console.error(
        `Batch Create: Ошибка при подготовке данных для элемента с __localId ${localIdStr}:`,
        transformError
      );
      failedNewDocs.push({
        __localId: localIdStr,
        message: `Ошибка преобразования данных: ${transformError.message}`,
      });
    }
  });

  if (docsToInsert.length === 0 && failedNewDocs.length > 0) {
    console.log(
      "Batch Create: Нет валидных элементов для вставки после обработки, есть ошибки валидации."
    );
    return res.json({ successNewDocs: [], failedNewDocs: failedNewDocs });
  } else if (docsToInsert.length === 0) {
    console.log("Batch Create: Нет валидных элементов для вставки.");
    return res.json({ successNewDocs: [], failedNewDocs: [] });
  }

  // 2. Выполнение пакетной вставки в MongoDB
  try {
    const insertResult = await DocModel.insertMany(docsToInsert, {
      ordered: false, // Продолжить вставку даже при ошибках
    });

    // Обработка успешных вставок
    if (Array.isArray(insertResult)) {
      insertResult.forEach((insertedDoc) => {
        const localIdString = insertedDoc.__localId.toHexString();
        const clientResult = initialClientResultsMap.get(localIdString);

        if (clientResult) {
          clientResult._id = insertedDoc._id.toHexString(); // Преобразуем серверный ID в строку
          clientResult.createdAt = insertedDoc.createdAt;
          clientResult.updatedAt = insertedDoc.updatedAt;
          clientResult.message = undefined; // Убираем временное сообщение
          successNewDocs.push(clientResult);
          initialClientResultsMap.delete(localIdString); // Удаляем из карты успешный
        } else {
          console.warn(
            "Batch Create: Успешно вставлен документ, но его __localId не найден в initialClientResultsMap:",
            localIdString
          );
          successNewDocs.push({
            __localId: localIdString,
            _id: insertedDoc._id.toHexString(),
            createdAt: insertedDoc.createdAt,
            updatedAt: insertedDoc.updatedAt,
            message:
              "Успешно вставлено, но возникла проблема с начальным сопоставлением",
          });
        }
      });
    }

    // Все, что осталось в initialClientResultsMap, считается неудачным (например, из-за дубликата __localId)
    // Это обрабатывается в catch блоке для writeErrors, но как запасной вариант:
    initialClientResultsMap.forEach((value) => {
      if (value.message === "Processing...") {
        failedNewDocs.push({
          __localId: value.__localId,
          message:
            "Вставка не удалась (неизвестная причина, возможно, дубликат __localId или другая ошибка БД)",
        });
      }
    });

    console.log(
      `Batch Create: Успешно вставлено ${successNewDocs.length} документов.`
    );
    console.log(
      `Batch Create: Ошибок при вставке ${failedNewDocs.length} документов.`
    );

    return res.json({ successNewDocs, failedNewDocs });
  } catch (error) {
    console.error("Batch Create: Общая ошибка при insertMany:", error);

    // Временная карта для отслеживания, какие localId уже обработаны в этом блоке
    const processedLocalIdsInCatch = new Set();

    // 1. Обработка специфических ошибок из writeErrors (если есть)
    if (error.writeErrors && Array.isArray(error.writeErrors)) {
      console.log("2222222 - Обработка writeErrors: Начало");
      error.writeErrors.forEach((writeError) => {
        const errorCode = writeError.err ? writeError.err.code : null;
        const errorMessageFromDb = writeError.err
          ? writeError.err.errmsg
          : "Неизвестная ошибка БД.";

        console.log(
          `DEBUG: writeError.index: ${writeError.index}, code: ${errorCode}, errmsg: ${errorMessageFromDb}`
        );

        const failedItemData = docsToInsert[writeError.index];
        if (failedItemData && failedItemData.__localId) {
          const localIdString = failedItemData.__localId.toHexString();

          // Гарантируем, что добавляем только один раз
          if (
            !processedLocalIdsInCatch.has(localIdString) &&
            !successNewDocs.some((doc) => doc.__localId === localIdString)
          ) {
            // Убедимся, что не успех

            let finalErrorMessage = errorMessageFromDb;
            let duplicateId = null;

            if (errorCode === 11000) {
              console.log("DEBUG: Код ошибки 11000 обнаружен.");
              const match = errorMessageFromDb.match(
                /dup key: \{ idDoc: (\d+) \}/
              );
              if (match && match[1]) {
                duplicateId = parseInt(match[1], 10);
                console.log("DEBUG: Найден дубликат ID:", duplicateId);
                finalErrorMessage = `Документ із ID ${duplicateId} вже існує. Будь ласка, використовуйте інший ID.`;
              } else {
                finalErrorMessage =
                  "Документ із таким ID вже існує. Будь ласка, використовуйте інший ID.";
              }
            }
            // else if (errorCode === 121) { /* Валидация схемы */ } и т.д.

            failedNewDocs.push({
              __localId: localIdString,
              message: finalErrorMessage,
              duplicateIdDoc: duplicateId,
            });
            processedLocalIdsInCatch.add(localIdString); // Отмечаем как обработанный в этом блоке
            console.log(
              `DEBUG: Добавлен в failedNewDocs: ${localIdString}, message: "${finalErrorMessage}"`
            );

            // Удаляем из initialClientResultsMap, так как мы его уже обработали
            if (initialClientResultsMap.has(localIdString)) {
              initialClientResultsMap.delete(localIdString);
            }
          } else {
            console.log(
              `DEBUG: Документ ${localIdString} уже обработан или был успешен.`
            );
          }
        } else {
          console.log(
            `DEBUG: failedItemData или __localId отсутствуют для writeError.index ${writeError.index}`
          );
        }
      });
      console.log("2222222 - Обработка writeErrors: Конец");
    }

    // 2. Обработка оставшихся элементов из initialClientResultsMap
    // Эти элементы не были вставлены успешно И не имели специфической writeError
    initialClientResultsMap.forEach((value, localIdString) => {
      // Если этот элемент еще не был добавлен в failedNewDocs (например, в writeErrors выше)
      if (!processedLocalIdsInCatch.has(localIdString)) {
        failedNewDocs.push({
          __localId: localIdString,
          message:
            error.message ||
            "Пакетная вставка не удалась (общая ошибка сервера).",
        });
        processedLocalIdsInCatch.add(localIdString); // Отмечаем как обработанный
      }
    });

    console.log(
      `Batch Create: Окончательно успешно вставлено ${successNewDocs.length} документов.`
    );
    console.log(
      `Batch Create: Окончательно ошибок при вставке ${failedNewDocs.length} документов.`
    );

    return res.status(500).json({ successNewDocs, failedNewDocs });
  }
};

export const batchUpdate = async (req, res) => {
  const updates = req.body;
  console.log("updates", updates);
  if (!Array.isArray(updates) || updates.length === 0) {
    return res
      .status(400)
      .json({ message: "Updates must be a non-empty array of post objects." });
  }

  const successUpdates = [];
  const failedUpdates = [];

  for (const docUpdate of updates) {
    const { _id, __localId, ...dataToUpdate } = docUpdate; // _id - это server_id, __localId - это локальный ID из Realm

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
      const updatedPost = await DocModel.findByIdAndUpdate(
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
  console.log("failedUpdates", failedUpdates);
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

export const batchDeleteDocs = async (req, res) => {
  console.log("Batch Delete: Получен запрос на пакетное МЯГКОЕ удаление doc.");
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
    // const nowTimestamp = Date.now();
    // const deletedIdValue = -nowTimestamp;
    const result = await DocModel.updateMany(
      {
        _id: { $in: objectIdsToSoftDelete },
        isPendingDeletion: false, // Опционально: обновлять только если пост еще не помечен как удаленный
      },
      [
        {
          $set: {
            isPendingDeletion: true,
            // idDoc: deletedIdValue,
            deletedAt: new Date(),
            updatedAt: new Date(), // Важно: Обновляем updatedAt, чтобы getChanges это "увидел"
          },
        },
      ]
    );
    if (result.modifiedCount > 0) {
      // modifiedCount показывает, сколько документов было изменено
      objectIdsToSoftDelete.forEach((id) => successIds.push(id.toString()));
    } else {
      // Если ни один документ не был изменен (например, если они уже были удалены)
      objectIdsToSoftDelete.forEach((id) => failedIds.push(id.toString()));
    }

    console.log(
      `Batch Soft Delete: Запрошено ${ids.length} ID, помечено как удаленные ${result.modifiedCount} постов.`
    );

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
        message: `Successfully soft deleted ${result.modifiedCount} docs.`,
        successIds,
      });
    }
  } catch (error) {
    console.error("Ошибка при пакетном мягком удалении документов:", error);
    return res
      .status(500)
      .json({ message: "Ошибка сервера при пакетном мягком удалении документов." });
  }
};

export const getChanges = async (req, res) => {
  try {
    const since = req.query.since
      ? new Date(req.query.since)
      : console.log("since не получен");
    const createdOrUpdatedDocs = await DocModel.find({
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
    createdOrUpdatedDocs.forEach((doc) => {
      if (doc.user && doc.user._id) {
        allUserIdsInChanges.add(doc.user._id.toString());
      }
      if (Array.isArray(doc.viewedByUsers)) {
        doc.viewedByUsers.forEach((userId) => {
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
    const deletedDocIds = await DocModel.find(
      {
        isPendingDeletion: true,
      },
      "_id"
    ) // Проекция: возвращаем только поле _id
      .lean()
      .exec()
      .then((docs) => docs.map((doc) => doc._id.toString())); // Преобразуем ObjectId в строки
    // 3. Получаем текущую метку времени сервера
    const serverCurrentTimestamp = new Date().toISOString();
    // const serverCurrentTimestamp = DateTime.fromJSDate(new Date())
    //   .setZone("Europe/Kiev")
    //   .toFormat("dd.MM.yyyy HH:mm:ss");

    // 4. Отправляем ответ клиенту
    res.json({
      createdOrUpdatedDocs,
      deletedDocIds,
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

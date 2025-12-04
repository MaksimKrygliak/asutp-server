// controllers/TerminalBlocksController.js
import TerminalBlockModel from "../models/TerminalBlock.js";
import SignalModel from "../models/Signal.js";
import EnclosureItemModel from "../models/EnclosureItem.js";
import mongoose from "mongoose";

export const createBatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const newTerminalBlocksBatch = req.body;
  if (
    !Array.isArray(newTerminalBlocksBatch) ||
    newTerminalBlocksBatch.length === 0
  ) {
    await session.endSession();
    return res.status(400).json({ message: "Нет данных для создания." });
  }

  const bulkCreateOps = [];
  const failedNewDocs = [];
  const enclosureItemsToUpdateMap = {};

  try {
    // 1. Предварительная загрузка родительских EnclosureItem для получения серверного _id
    // Клиент присылает 'enclosureItem' как __localId родительского EnclosureItem
    const local_IDEnclosureItems = [
      ...new Set(
        newTerminalBlocksBatch
          .map((item) => item.enclosureItem)
          .filter((id) => id)
      ),
    ];

    const serverEnclosureItems = await EnclosureItemModel.find({
      __localId: { $in: local_IDEnclosureItems },
    }).session(session);

    const serverEnclosureItemMap = serverEnclosureItems.reduce((map, item) => {
      map[item.__localId.toString()] = item;
      return map;
    }, {});

    // 2. Подготовка операций и генерация временных ID
    for (const item of newTerminalBlocksBatch) {
      // 1. Проверка обязательных полей
      if (!item.__localId || !item.enclosureItem || !item.title) {
        failedNewDocs.push({
          __localId: item.__localId,
          message:
            "Отсутствуют обязательные поля: __localId, enclosureItem или title.",
        });
        continue;
      }

      // 2. Поиск родителя (EnclosureItem) по клиентскому __localId
      const parentEnclosureItem = serverEnclosureItemMap[item.enclosureItem];

      if (!parentEnclosureItem) {
        failedNewDocs.push({
          __localId: item.__localId,
          message: `Родительский шкаф с локальным ID ${item.enclosureItem} не найден.`,
        });
        continue;
      }

      // --- ИСПРАВЛЕНО: Генерируем ID только один раз ---
      const newServerId = new mongoose.Types.ObjectId();
      const parentServerIdStr = parentEnclosureItem._id.toHexString();
      const parentServerId = parentEnclosureItem._id;

      const newDoc = {
        ...item,
        _id: newServerId,
        enclosureItem: item.enclosureItem,
        createdAt: new Date(),
        updatedAt: new Date(),
        synced: true,
        isPendingDeletion: item.isPendingDeletion || false,
      };

      bulkCreateOps.push({
        insertOne: {
          document: newDoc,
        },
      });

      // 3. Подготовка карты для обновления родителя
      if (!enclosureItemsToUpdateMap[parentServerIdStr]) {
        enclosureItemsToUpdateMap[parentServerIdStr] = [];
      }

      // ✅ Добавляем тот же newServerId (ID, который будет создан) в карту
      enclosureItemsToUpdateMap[parentServerIdStr].push(item.__localId);
    }

    // 3. Фаза 1: Создание клеммных блоков
    const createResult = await TerminalBlockModel.bulkWrite(bulkCreateOps, {
      session,
      ordered: false,
    });

    // 4. Формирование ответа после создания
    const successNewDocs = [];
    const createdIdsMap = createResult.insertedIds;

    // Сопоставление созданных ID с оригинальными данными (важно для __localId)
    for (const [key, serverId] of Object.entries(createdIdsMap)) {
      const originalIndex = parseInt(key, 10);
      const originalDoc = newTerminalBlocksBatch[originalIndex];

      successNewDocs.push({
        _id: serverId.toHexString(), // Серверный ID
        __localId: originalDoc.__localId,
        updatedAt: originalDoc.updatedAt || new Date(), // Используем обновленный
      });
    }

    // 5. Фаза 2: Обновление родительских шкафов (добавление ссылок)
    const bulkEnclosureItemUpdateOps = Object.keys(
      enclosureItemsToUpdateMap
    ).map((parentServerId) => {
      // Серверные ID новых клеммных блоков
      const serverTerminalBlockIds = enclosureItemsToUpdateMap[parentServerId];

      return {
        updateOne: {
          // Ищем EnclosureItem по его СЕРВЕРНОМУ _id
          filter: { _id: new mongoose.Types.ObjectId(parentServerId) },
          update: {
            // $addToSet гарантирует, что не будет дубликатов
            $addToSet: {
              terminalBlocks: { $each: serverTerminalBlockIds },
            },
            updatedAt: new Date(),
          },
        },
      };
    });

    if (bulkEnclosureItemUpdateOps.length > 0) {
      await EnclosureItemModel.bulkWrite(bulkEnclosureItemUpdateOps, {
        session,
      });
    }

    await session.commitTransaction();
    res.json({ successNewDocs, failedNewDocs });
  } catch (error) {
    await session.abortTransaction();
    console.error("Ошибка пакетного создания TerminalBlock:", error);
    res.status(500).json({
      message: "Не удалось выполнить пакетное создание клеммных блоков.",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

export const updateBatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const updatedTerminalBlocksBatch = req.body;
  const bulkUpdateOps = [];
  const successfulDocsBeforeExecution = [];
  const failedUpdatedDocs = [];
  const pullFromParents = {}; // { oldParentId: [terminalBlockId] }
  const pushToParents = {}; // { newParentId: [terminalBlockId] }

  try {
    // 1. Предварительная загрузка старых документов
    const serverIdsToFind = updatedTerminalBlocksBatch
      .filter((item) => item._id && mongoose.Types.ObjectId.isValid(item._id))
      .map((item) => new mongoose.Types.ObjectId(item._id));

    if (serverIdsToFind.length === 0 && updatedTerminalBlocksBatch.length > 0) {
      updatedTerminalBlocksBatch
        .filter(
          (item) => !item._id || !mongoose.Types.ObjectId.isValid(item._id)
        )
        .forEach((item) => {
          failedUpdatedDocs.push({
            __localId: item.__localId,
            message: "Отсутствует или невалидный _id.",
          });
        });
      await session.commitTransaction();
      session.endSession();
      return res
        .status(200)
        .json({ successUpdatedDocs: [], failedUpdatedDocs });
    }

    const oldDocsMap = await TerminalBlockModel.find({
      _id: { $in: serverIdsToFind },
    })
      .select("_id enclosureItem") // Нам нужен только _id и enclosureItem
      .session(session)
      .lean()
      .then((docs) =>
        docs.reduce((map, doc) => {
          map[doc._id.toString()] = doc;
          return map;
        }, {})
      );

    // 2. Сбор операций обновления и логики смены родителя
    for (const item of updatedTerminalBlocksBatch) {
      if (!item._id || !mongoose.Types.ObjectId.isValid(item._id)) {
        continue;
      }

      const serverId = new mongoose.Types.ObjectId(item._id);
      const serverIdStr = serverId.toHexString();
      const oldDoc = oldDocsMap[serverIdStr];

      if (!oldDoc) {
        failedUpdatedDocs.push({
          __localId: item.__localId,
          message: `Клеммный блок с ID ${item._id} не найден.`,
        });
        continue;
      }

      const oldParentIdStr = oldDoc.enclosureItem
        ? oldDoc.enclosureItem.toString()
        : null;
      // Используем item.enclosureItem из входящих данных
      const newParentIdStr = item.enclosureItem || null;

      // Валидация нового ID родителя перед использованием
      const isValidNewParent =
        newParentIdStr && mongoose.Types.ObjectId.isValid(newParentIdStr);

      // Определяем финальный ID родителя для записи в БД
      const finalParentId = isValidNewParent
        ? new mongoose.Types.ObjectId(newParentIdStr)
        : null;

      // Логика перемещения между родителями (EnclosureItem)
      if (oldParentIdStr !== newParentIdStr) {
        // Удаление из старого родителя (pull)
        if (oldParentIdStr) {
          if (!pullFromParents[oldParentIdStr])
            pullFromParents[oldParentIdStr] = [];
          pullFromParents[oldParentIdStr].push(serverId);
        }

        // Добавление в нового родителя (push) только если ID валиден
        if (isValidNewParent) {
          if (!pushToParents[newParentIdStr])
            pushToParents[newParentIdStr] = [];
          pushToParents[newParentIdStr].push(serverId);
        }
      }

      // Операция обновления самого клеммного блока
      bulkUpdateOps.push({
        updateOne: {
          filter: { _id: serverId },
          update: {
            $set: {
              title: item.title,
              description: item.description,
              position: item.position,
              enclosureItem: finalParentId, // Обновляем ссылку на родителя
              isPendingDeletion: item.isPendingDeletion || false,
              updatedAt: new Date(),
            },
          },
        },
      });

      successfulDocsBeforeExecution.push({
        __localId: item.__localId,
        _id: serverIdStr,
        updatedAt: new Date(),
      });
    }

    // 3. Выполнение пакетного обновления клеммных блоков
    let updateResult = { writeErrors: [] };
    if (bulkUpdateOps.length > 0) {
      updateResult = await TerminalBlockModel.bulkWrite(bulkUpdateOps, {
        session,
        ordered: false,
      });
    }

    // 4. Обновление родительских шкафов (pull)
    const pullOps = Object.keys(pullFromParents).map((parentId) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(parentId) },
        update: {
          $pullAll: { terminalBlocks: pullFromParents[parentId] },
          $set: { updatedAt: new Date() },
        },
      },
    }));
    if (pullOps.length > 0) {
      await EnclosureItemModel.bulkWrite(pullOps, { session });
    }

    // 5. Обновление родительских шкафов (push)
    const pushOps = Object.keys(pushToParents).map((parentId) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(parentId) },
        update: {
          $addToSet: { terminalBlocks: { $each: pushToParents[parentId] } },
          $set: { updatedAt: new Date() },
        },
      },
    }));

    if (pushOps.length > 0) {
      await EnclosureItemModel.bulkWrite(pushOps, { session });
    }

    // 6. Формирование ответа
    const successfulIds = [];
    if (updateResult.writeErrors && updateResult.writeErrors.length > 0) {
      const failedIndices = updateResult.writeErrors.map((err) => err.index);

      for (let i = 0; i < successfulDocsBeforeExecution.length; i++) {
        const originalResult = successfulDocsBeforeExecution[i];

        if (failedIndices.includes(i)) {
          failedUpdatedDocs.push({
            __localId: originalResult.__localId,
            message: "Ошибка обновления в БД (BulkWrite).",
          });
        } else {
          successfulIds.push(originalResult);
        }
      }
    } else {
      successfulIds.push(...successfulDocsBeforeExecution);
    }

    await session.commitTransaction();
    res.json({ successUpdatedDocs: successfulIds, failedUpdatedDocs });
  } catch (error) {
    await session.abortTransaction();
    console.error("Ошибка пакетного обновления TerminalBlock:", error);
    res.status(500).json({
      message: "Не удалось выполнить пакетное обновление клеммных блоков.",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

export const deleteBatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    session.endSession();
    return res.status(400).json({ message: "IDs должен быть массивом." });
  }

  // 1. Валидация и подготовка ID
  const validIdMap = new Map();
  ids.forEach((idString) => {
    if (mongoose.Types.ObjectId.isValid(idString)) {
      validIdMap.set(idString, new mongoose.Types.ObjectId(idString));
    }
  });

  const validIds = Array.from(validIdMap.values());
  const initialValidIdStrings = Array.from(validIdMap.keys()); // Исходные валидные строки ID

  if (validIds.length === 0) {
    session.endSession();
    return res.status(400).json({
      message: "Не предоставлено ни одного корректного ObjectId для удаления.",
    });
  }

  let isCommitted = false;

  try {
    const now = new Date();

    // 2. Находим клеммные блоки, которые НЕ помечены на удаление
    const terminalBlocksMongoDB = await TerminalBlockModel.find({
      _id: { $in: validIds }, // Ищем по Server ID
      isPendingDeletion: false,
    })
      .select("_id __localId enclosureItem")
      .session(session);

    const terminalBlockLocalIDs = terminalBlocksMongoDB.map((t) => t.__localId);

    // 3. Определяем ID, которые уже были удалены (логика фикса)
    const successfullyFoundIds = terminalBlocksMongoDB.map((t) =>
      t._id.toHexString()
    );

    const alreadyDeletedIds = initialValidIdStrings.filter((idString) => {
      return !successfullyFoundIds.includes(idString);
    });

    // 4. Обработка случая, когда нет НОВЫХ клеммных блоков для мягкого удаления
    if (terminalBlockLocalIDs.length === 0) {
      await session.commitTransaction();
      isCommitted = true;

      // Если ни один блок не был найден, значит, все они уже удалены/помечены.
      return res.status(200).json({
        success: true,
        message:
          "Все запрошенные клеммные блоки не найдены в базе (возможно, уже удалены).",
        // Все валидные ID считаются "успешно обработанными"
        successDeletedDocIds: initialValidIdStrings,
        failedDeletedDocIds: [],
      });
    }

    // --- 5. КАСКАДНЫЙ ПОИСК ДОЧЕРНИХ ЭЛЕМЕНТОВ (Сигналы) ---

    let signalLocalIDs = [];
    const signalsToUpdate = await SignalModel.find({
      terminalBlock: { $in: terminalBlockLocalIDs },
      isPendingDeletion: false,
    })
      .session(session)
      .select("__localId");
    signalLocalIDs = signalsToUpdate.map((doc) => doc.__localId);

    // --- 6. МЯГКОЕ УДАЛЕНИЕ ДОЧЕРНИХ ЭЛЕМЕНТОВ (Сигналы) ---

    if (signalLocalIDs.length > 0) {
      await SignalModel.updateMany(
        { __localId: { $in: signalLocalIDs } },
        {
          $set: {
            isPendingDeletion: true,
            deletedAt: now,
            updatedAt: now,
          },
        },
        { session: session }
      );
    }

    // --- 7. МЯГКОЕ УДАЛЕНИЕ САМИХ КЛЕММНЫХ БЛОКОВ (TerminalBlock) ---

    const result = await TerminalBlockModel.updateMany(
      { __localId: { $in: terminalBlockLocalIDs } },
      {
        $set: {
          signals: [],
          isPendingDeletion: true,
          deletedAt: now,
          updatedAt: now,
        },
      },
      { session }
    );

    // --- 8. ОЧИСТКА РОДИТЕЛЬСКОГО ШКАФА (EnclosureItem) ---

    const enclosureTerminalMap = {};
    terminalBlocksMongoDB.forEach((item) => {
      // item.enclosureItem хранит __localId родительского EnclosureItem
      const enclosureLocalId = item.enclosureItem.toString();
      if (!enclosureTerminalMap[enclosureLocalId]) {
        enclosureTerminalMap[enclosureLocalId] = [];
      }
      enclosureTerminalMap[enclosureLocalId].push(item.__localId);
    });

    const bulkEnclosurePullOps = Object.keys(enclosureTerminalMap).map(
      (enclosureLocalId) => ({
        updateOne: {
          // Ищем EnclosureItem по его __localId
          filter: { __localId: new mongoose.Types.ObjectId(enclosureLocalId) },
          update: {
            // Удаляем ссылки на удаленные клеммные блоки из массива terminalBlocks
            $pullAll: {
              terminalBlocks: enclosureTerminalMap[enclosureLocalId],
            },
            $set: { updatedAt: now },
          },
        },
      })
    );

    if (bulkEnclosurePullOps.length > 0) {
      await EnclosureItemModel.bulkWrite(bulkEnclosurePullOps, { session });
    }

    await session.commitTransaction();
    isCommitted = true;

    // 9. Формирование финального ответа

    // successDeletedDocIds = успешно помеченные ИЛИ те, что уже были удалены (alreadyDeletedIds)
    const finalSuccessIds = [...successfullyFoundIds, ...alreadyDeletedIds];

    // failedDeletedDocIds: ID, которые не смогли быть обработаны из-за ошибки (здесь они должны быть пусты)
    const finalFailedIds = initialValidIdStrings.filter(
      (id) => !finalSuccessIds.includes(id)
    );

    return res.status(200).json({
      success: true,
      message: `Успешно помечено на удаление ${result.modifiedCount} клеммных блоков и их дочерних элементов. Учтено ${alreadyDeletedIds.length} уже удаленных.`,
      successDeletedDocIds: finalSuccessIds,
      failedDeletedDocIds: finalFailedIds, // Должен быть пустым
    });
  } catch (error) {
    console.error("Ошибка при пакетном мягком удалении TerminalBlock:", error);
    if (session.inTransaction() && !isCommitted) {
      await session.abortTransaction();
    }
    if (error.name === "MongoTransactionError") {
      console.warn("MongoTransactionError (повторный abort): Проигнорировано.");
    }

    return res.status(500).json({ message: "Ошибка сервера при удалении." });
  } finally {
    session.endSession();
  }
};

export const getChanges = async (req, res) => {
  try {
    const lastSync = req.query.since ? new Date(req.query.since) : new Date(0);
    const serverCurrentTimestamp = new Date();

    const allChanges = await TerminalBlockModel.find({
      $or: [{ createdAt: { $gt: lastSync } }, { updatedAt: { $gt: lastSync } }],
    });

    const createdOrUpdatedTerminalBlocks = allChanges.filter(
      (item) => !item.isPendingDeletion
    );

    const deletedTerminalBlockIds = allChanges
      .filter((item) => item.isPendingDeletion)
      .map((item) => item.__localId.toHexString());

    const simplifiedItems = createdOrUpdatedTerminalBlocks.map((item) => ({
      ...item.toObject(),
      _id: item._id.toHexString(),
      // Если __localId является обязательным, убедитесь, что он также преобразован
      __localId: item.__localId ? item.__localId.toHexString() : undefined,
    }));

    res.json({
      createdOrUpdatedTerminalBlocks: simplifiedItems,
      deletedTerminalBlockIds,
      serverCurrentTimestamp,
    });
  } catch (error) {
    console.error("Ошибка получения изменений для TerminalBlock:", error);
    res.status(500).json({
      message: "Не удалось получить изменения для клеммных блоков.",
      error: error.message,
    });
  }
};

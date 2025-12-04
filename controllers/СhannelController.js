import SignalModel from "../models/Signal.js"; // Предполагается, что вы импортируете Signal из отдельного файла
import TerminalBlockModel from "../models/TerminalBlock.js"; // Предполагается, что вы импортируете TerminalBlock из отдельного файла
import mongoose from "mongoose";

export const createBatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const newSignalItemsBatch = req.body;
  if (!Array.isArray(newSignalItemsBatch) || newSignalItemsBatch.length === 0) {
    await session.endSession();
    return res
      .status(400)
      .json({ message: "Нет данных для создания сигналов." });
  }

  const bulkCreateOps = [];
  const failedNewDocs = [];
  const terminalBlocksToUpdateMap = {};

  try {
    // 1. Предварительная загрузка родительских TerminalBlock по их __localId
    const localTerminalBlockIds = [
      ...new Set(
        newSignalItemsBatch.map((item) => item.terminalBlock).filter((id) => id)
      ),
    ];

    // Ищем родительские блоки, используя __localId
    const serverTerminalBlocks = await TerminalBlockModel.find({
      __localId: { $in: localTerminalBlockIds },
    }).session(session);

    const serverTerminalBlockMap = serverTerminalBlocks.reduce(
      (map, terminalBlock) => {
        map[terminalBlock.__localId.toString()] = terminalBlock;
        return map;
      },
      {}
    );

    // 2. Подготовка операций и генерация временных ID
    for (let i = 0; i < newSignalItemsBatch.length; i++) {
      const item = newSignalItemsBatch[i];

      // Проверка обязательных полей
      if (!item.__localId || !item.terminalBlock || !item.title) {
        failedNewDocs.push({
          __localId: item.__localId,
          message:
            "Отсутствуют обязательные поля: __localId, terminalBlock или title.",
        });
        continue;
      }

      const parentTerminalBlock = serverTerminalBlockMap[item.terminalBlock];

      if (!parentTerminalBlock) {
        failedNewDocs.push({
          __localId: item.__localId,
          message: `Родительская клемная колодка с локальным ID ${item.terminalBlock} не найдена.`,
        });
        continue;
      }

      // Генерируем новый серверный _id заранее
      const newServerId = new mongoose.Types.ObjectId();
      const parentServerId = parentTerminalBlock._id.toHexString();

      const newDoc = {
        ...item,
        _id: newServerId,
        terminalBlock: item.terminalBlock,
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

      // ИСПРАВЛЕНО #2: Добавляем ЛОКАЛЬНЫЙ ID нового сигнала в карту для обновления родителя
      if (!terminalBlocksToUpdateMap[parentServerId]) {
        terminalBlocksToUpdateMap[parentServerId] = [];
      }
      terminalBlocksToUpdateMap[parentServerId].push(item.__localId.toString());
    }

    // 3. Фаза 1: Создание сигналов
    const createResult = await SignalModel.bulkWrite(bulkCreateOps, {
      session,
      ordered: false,
    });

    // 4. Формирование ответа после создания
    const successNewDocs = [];
    const createdIdsMap = createResult.insertedIds;

    for (const [key, serverId] of Object.entries(createdIdsMap)) {
      const originalIndex = parseInt(key, 10);
      const originalDoc = newSignalItemsBatch[originalIndex];

      successNewDocs.push({
        _id: serverId.toHexString(),
        __localId: originalDoc.__localId,
        updatedAt: new Date(),
      });
    }

    // 5. Фаза 2: Обновление родительских TerminalBlock (добавление ссылок в массив signals)
    const bulkTerminalBlockUpdateOps = Object.keys(
      terminalBlocksToUpdateMap
    ).map((parentServerId) => {
      // serverSignalIds теперь содержит массив ЛОКАЛЬНЫХ ID (строк)
      const localSignalIds = terminalBlocksToUpdateMap[parentServerId];

      return {
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(parentServerId) },
          update: {
            // Добавляем ЛОКАЛЬНЫЕ ID сигналов в массив signals родителя
            $addToSet: {
              signals: { $each: localSignalIds },
            },
            updatedAt: new Date(),
          },
        },
      };
    });

    if (bulkTerminalBlockUpdateOps.length > 0) {
      await TerminalBlockModel.bulkWrite(bulkTerminalBlockUpdateOps, {
        session,
      });
    }

    await session.commitTransaction();
    res.json({ successNewDocs, failedNewDocs });
  } catch (error) {
    await session.abortTransaction();
    console.error("Ошибка пакетного создания Signal:", error);
    res.status(500).json({
      message: "Не удалось выполнить пакетное создание сигналов.",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};
// --- UPDATE BATCH (Пакетное обновление сигналов) ---
export const updateBatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const updatedSignalItemsBatch = req.body;
  const bulkUpdateOps = [];
  const successfulDocsBeforeExecution = [];
  const failedUpdatedDocs = [];
  const pullFromParents = {}; // { oldParentId: [signalId] }
  const pushToParents = {}; // { newParentId: [signalId] }

  // Предварительная фильтрация невалидных ID
  const serverIdsToFind = updatedSignalItemsBatch
    .filter((item) => item._id && mongoose.Types.ObjectId.isValid(item._id))
    .map((item) => new mongoose.Types.ObjectId(item._id));

  if (serverIdsToFind.length === 0 && updatedSignalItemsBatch.length > 0) {
    updatedSignalItemsBatch
      .filter((item) => !item._id || !mongoose.Types.ObjectId.isValid(item._id))
      .forEach((item) => {
        failedUpdatedDocs.push({
          __localId: item.__localId,
          message: "Отсутствует или невалидный _id.",
        });
      });
    await session.commitTransaction();
    session.endSession();
    return res.status(200).json({ successUpdatedDocs: [], failedUpdatedDocs });
  }

  try {
    // 1. Предварительная загрузка старых документов (для сравнения родителя)
    const oldDocsMap = await SignalModel.find({
      _id: { $in: serverIdsToFind },
    })
      .select("_id terminalBlock") // Выбираем только ID и ссылку на родителя
      .session(session)
      .lean()
      .then((docs) =>
        docs.reduce((map, doc) => {
          map[doc._id.toString()] = doc;
          return map;
        }, {})
      );

    // 2. Сбор операций обновления и логики смены родителя
    for (const item of updatedSignalItemsBatch) {
      if (!item._id || !mongoose.Types.ObjectId.isValid(item._id)) {
        continue;
      }

      const serverId = new mongoose.Types.ObjectId(item._id);
      const serverIdStr = serverId.toHexString();
      const oldDoc = oldDocsMap[serverIdStr];

      if (!oldDoc) {
        failedUpdatedDocs.push({
          __localId: item.__localId,
          message: `Сигнал с ID ${item._id} не найден.`,
        });
        continue;
      }

      // Получаем старый и новый ID родителя (TerminalBlock)
      const oldParentIdStr = oldDoc.terminalBlock
        ? oldDoc.terminalBlock.toString()
        : null;
      const newParentIdStr = item.terminalBlock || null;

      const isValidNewParent =
        newParentIdStr && mongoose.Types.ObjectId.isValid(newParentIdStr);

      // Финальный ID родителя для записи в Signal
      const finalParentId = isValidNewParent
        ? new mongoose.Types.ObjectId(newParentIdStr)
        : null;

      // Логика перемещения между родителями (TerminalBlock)
      if (oldParentIdStr !== newParentIdStr) {
        // Удаление из старого родителя (pull)
        if (oldParentIdStr) {
          if (!pullFromParents[oldParentIdStr])
            pullFromParents[oldParentIdStr] = [];
          pullFromParents[oldParentIdStr].push(serverId);
        }

        // Добавление в нового родителя (push)
        if (isValidNewParent) {
          if (!pushToParents[newParentIdStr])
            pushToParents[newParentIdStr] = [];
          pushToParents[newParentIdStr].push(serverId);
        }
      }

      // Операция обновления самого сигнала
      bulkUpdateOps.push({
        updateOne: {
          filter: { _id: serverId },
          update: {
            $set: {
              // Поля, специфичные для Signal (из вашей схемы)
              title: item.title,
              address: item.address,
              type: item.type,
              location: item.location,
              minValue: item.minValue,
              maxValue: item.maxValue,
              description: item.description,
              terminalBlock: finalParentId, // Обновляем ссылку на родителя
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

    // 3. Выполнение пакетного обновления сигналов
    let updateResult = { writeErrors: [] };
    if (bulkUpdateOps.length > 0) {
      updateResult = await SignalModel.bulkWrite(bulkUpdateOps, {
        session,
        ordered: false,
      });
    }

    // 4. Обновление родительских блоков (pull) - удаление ссылок из старых родителей
    const pullOps = Object.keys(pullFromParents).map((parentId) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(parentId) },
        update: {
          $pullAll: { signals: pullFromParents[parentId] }, // Удаляем из массива signals
          $set: { updatedAt: new Date() },
        },
      },
    }));
    if (pullOps.length > 0) {
      await TerminalBlockModel.bulkWrite(pullOps, { session });
    }

    // 5. Обновление родительских блоков (push) - добавление ссылок в новых родителей
    const pushOps = Object.keys(pushToParents).map((parentId) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(parentId) },
        update: {
          $addToSet: { signals: { $each: pushToParents[parentId] } }, // Добавляем в массив signals
          $set: { updatedAt: new Date() },
        },
      },
    }));

    if (pushOps.length > 0) {
      await TerminalBlockModel.bulkWrite(pushOps, { session });
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
    console.error("Ошибка пакетного обновления Signal:", error);
    res.status(500).json({
      message: "Не удалось выполнить пакетное обновление сигналов.",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// --- DELETE BATCH (Мягкое удаление сигналов) ---
export const deleteBatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
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

    const validObjectIds = Array.from(validIdMap.values());
    const initialValidIdStrings = Array.from(validIdMap.keys()); // Исходные валидные строки ID

    if (validObjectIds.length === 0) {
      session.endSession();
      return res.status(400).json({ message: "Некорректные ID для удаления." });
    }

    let isCommitted = false;

    // 2. Находим сигналы, которые НЕ помечены на удаление
    const signalsToDelete = await SignalModel.find({
      _id: { $in: validObjectIds },
      isPendingDeletion: false,
    })
      .select("_id __localId terminalBlock")
      .session(session);

    // 3. Определяем ID, которые уже были удалены (логика фикса)
    const successfullyFoundIds = signalsToDelete.map((item) =>
      item._id.toHexString()
    );

    const alreadyDeletedIds = initialValidIdStrings.filter((idString) => {
      return !successfullyFoundIds.includes(idString);
    });

    // 4. Обработка случая, когда нет НОВЫХ сигналов для мягкого удаления
    if (signalsToDelete.length === 0) {
      await session.commitTransaction();
      isCommitted = true;
      session.endSession();

      // Если ни один сигнал не был найден, значит, все они уже удалены/помечены.
      return res.status(200).json({
        message:
          "Все запрошенные сигналы не найдены в базе (возможно, уже удалены).",
        // Все валидные ID считаются "успешно обработанными"
        successDeletedDocIds: initialValidIdStrings,
        failedDeletedDocIds: [],
      });
    }

    // --- 5. Выполняем мягкое удаление сигналов ---

    // Используем серверный ID для мягкого удаления
    const result = await SignalModel.updateMany(
      { _id: { $in: successfullyFoundIds }, isPendingDeletion: false },
      { $set: { isPendingDeletion: true, updatedAt: new Date() } },
      { session: session }
    );

    // 6. Подготавливаем операции для родительских TerminalBlock (удаление ссылок - $pull)
    const terminalBlockPullOps = signalsToDelete
      .filter((item) => item.terminalBlock && item.__localId)
      .map((item) => ({
        updateOne: {
          filter: { __localId: item.terminalBlock },
          update: {
            $pull: { signals: item.__localId },
            $set: { updatedAt: new Date() },
          },
        },
      }));

    if (terminalBlockPullOps.length > 0) {
      await TerminalBlockModel.bulkWrite(terminalBlockPullOps, { session });
    }

    // 7. ФИНАЛЬНЫЙ ОТВЕТ
    await session.commitTransaction();
    isCommitted = true;

    // successDeletedDocIds: успешно помеченные ИЛИ те, что уже были удалены (alreadyDeletedIds)
    const finalSuccessIds = [...successfullyFoundIds, ...alreadyDeletedIds];

    // failedDeletedDocIds: ID, которые не смогли быть обработаны из-за ошибки (здесь они должны быть пусты)
    const finalFailedIds = initialValidIdStrings.filter(
      (id) => !finalSuccessIds.includes(id)
    );

    return res.status(200).json({
      success: true,
      message: `Успешно помечено на удаление ${result.modifiedCount} сигналов. Учтено ${alreadyDeletedIds.length} уже удаленных.`,
      successDeletedDocIds: finalSuccessIds,
      failedDeletedDocIds: finalFailedIds, // Должен быть пустым
    });
  } catch (error) {
    console.error("Ошибка пакетного мягкого удаления Signal:", error);
    if (session.inTransaction() && !isCommitted) {
      await session.abortTransaction();
    }
    res.status(500).json({
      message: "Не удалось выполнить пакетное мягкое удаление сигналов.",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

export const getChanges = async (req, res) => {
  try {
    const lastSync = req.query.since ? new Date(req.query.since) : new Date(0);
    const serverCurrentTimestamp = new Date();
    // Находим все сигналы, которые были созданы или обновлены с момента последней синхронизации
    const allChanges = await SignalModel.find({
      $or: [{ createdAt: { $gt: lastSync } }, { updatedAt: { $gt: lastSync } }],
    }).lean();

    const createdOrUpdatedSignals = allChanges.filter(
      (item) => !item.isPendingDeletion
    );

    const deletedSignalIds = allChanges
      .filter((item) => item.isPendingDeletion)
      .map((item) => item._id.toHexString());

    // Преобразуем ObjectId в строки для клиента
    const simplifiedItems = createdOrUpdatedSignals.map((item) => ({
      ...item,
      _id: item._id.toHexString(),
      // terminalBlock - это ссылка на родителя. Преобразуем в строку.
      terminalBlock: item.terminalBlock
        ? item.terminalBlock.toHexString()
        : null,
      // __localId также преобразуется, если хранится как ObjectId, как в вашей схеме
      __localId: item.__localId ? item.__localId.toHexString() : null,
    }));

    res.json({
      createdOrUpdatedSignals: simplifiedItems,
      deletedSignalIds,
      serverCurrentTimestamp,
    });
  } catch (error) {
    console.error("Ошибка получения изменений для Signal:", error);
    res.status(500).json({
      message: "Не удалось получить изменения для сигналов.",
      error: error.message,
    });
  }
};

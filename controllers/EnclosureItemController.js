// controllers/EnclosureItemController.js
import EnclosureItemModel from "../models/EnclosureItem.js";
import TerminalBlockModel from "../models/TerminalBlock.js";
import SignalModel from "../models/Signal.js";
import PremiseModel from "../models/Premise.js";
import mongoose from "mongoose";

const createOrUpdateEnclosureItem = async (Model, item, session) => {
  if (item._id) {
    // Обновление
    const doc = await Model.findByIdAndUpdate(
      item._id,
      {
        title: item.title,
        description: item.description,
        parent: item.parent,
        terminalBlocks: item.terminalBlocks, // Встроенные документы обновляются целиком
        updatedAt: new Date(),
        isPendingDeletion: item.isPendingDeletion,
      },
      { new: true, session: session }
    );
    if (doc) {
      return {
        success: true,
        doc: {
          __localId: item.__localId,
          _id: doc._id.toHexString(),
          updatedAt: doc.updatedAt,
        },
      };
    }
    return {
      success: false,
      doc: {
        __localId: item.__localId,
        message: `${Model.modelName} с ID ${item._id} не найден.`,
      },
    };
  } else {
    // Создание
    const newEnclosureItem = new Model({
      __localId: item.__localId,
      title: item.title,
      description: item.description,
      parent: item.parent,
      terminalBlocks: item.terminalBlocks,
    });
    const doc = await newEnclosureItem.save({ session: session });

    // Добавляем EnclosureItem в массив 'enclosures' его родительского Premise
    if (doc.parent) {
      await PremiseModel.findByIdAndUpdate(
        doc.parent,
        { $addToSet: { enclosures: doc._id } },
        { session: session }
      );
    }
    return {
      success: true,
      doc: {
        __localId: item.__localId,
        _id: doc._id.toHexString(),
        updatedAt: doc.updatedAt,
      },
    };
  }
};

// Исправленный и разделенный контроллер для пакетного создания
export const createBatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const newEnclosureItemsBatch = req.body;
  if (
    !Array.isArray(newEnclosureItemsBatch) ||
    newEnclosureItemsBatch.length === 0
  ) {
    await session.endSession();
    return res.status(400).json({ message: "Нет данных для создания." });
  }

  const bulkCreateOps = [];
  const failedNewDocs = [];
  // Карта для обновления Premise: { ParentServerId: [ChildLocalIdString, ...] }
  const premisesToUpdateMap = {};

  try {
    // 1. Предварительная загрузка родительских Premise для получения серверного _id
    const localPremiseIds = [
      ...new Set(
        newEnclosureItemsBatch.map((item) => item.premise).filter((id) => id)
      ),
    ];

    const serverPremises = await PremiseModel.find({
      __localId: { $in: localPremiseIds },
    }).session(session);

    const serverPremiseMap = serverPremises.reduce((map, premise) => {
      map[premise.__localId.toString()] = premise;
      return map;
    }, {});

    // 2. Подготовка операций и генерация временных ID
    for (const item of newEnclosureItemsBatch) {
      // Цикл for...of
      if (!item.__localId || !item.premise) {
        failedNewDocs.push({
          __localId: item.__localId,
          message: "Отсутствуют обязательные поля: __localId или premise.",
        });
        continue;
      }

      const parentPremise = serverPremiseMap[item.premise];

      if (!parentPremise) {
        failedNewDocs.push({
          __localId: item.__localId,
          message: `Родительское помещение с локальным ID ${item.premise} не найдено.`,
        });
        continue;
      }

      // Генерируем новый серверный _id заранее
      const newServerId = new mongoose.Types.ObjectId();
      const parentServerIdStr = parentPremise._id.toHexString();
      // const parentServerId = parentPremise._id;

      const newDoc = {
        ...item,
        _id: newServerId,
        premise: item.premise,
        createdAt: new Date(),
        updatedAt: new Date(),
        synced: true,
      };

      bulkCreateOps.push({
        insertOne: {
          document: newDoc,
        },
      });

      // 3. Подготовка карты для обновления родителя
      if (!premisesToUpdateMap[parentServerIdStr]) {
        premisesToUpdateMap[parentServerIdStr] = [];
      }

      // ИМПЛЕМЕНТАЦИЯ ЗАПРОСА: Добавляем ЛОКАЛЬНЫЙ ID (строка) шкафа в карту
      premisesToUpdateMap[parentServerIdStr].push(item.__localId.toString());
    }

    // 3. Фаза 1: Создание шкафов
    const createResult = await EnclosureItemModel.bulkWrite(bulkCreateOps, {
      session,
      ordered: false,
    });

    // 4. Формирование ответа после создания
    const successNewDocs = [];
    const createdIdsMap = createResult.insertedIds;

    for (const [key, serverId] of Object.entries(createdIdsMap)) {
      const originalIndex = parseInt(key, 10);
      const originalDoc = newEnclosureItemsBatch[originalIndex];

      successNewDocs.push({
        _id: serverId.toHexString(), // Серверный ID
        __localId: originalDoc.__localId,
        updatedAt: originalDoc.updatedAt || new Date(),
      });
    }

    // 5. Фаза 2: Обновление родительских помещений (добавление ссылок)
    const bulkPremiseUpdateOps = Object.keys(premisesToUpdateMap).map(
      (parentServerId) => {
        // enclosureLocalIds теперь содержит массив ЛОКАЛЬНЫХ ID (строк)
        const enclosureLocalIds = premisesToUpdateMap[parentServerId];

        return {
          updateOne: {
            filter: { _id: new mongoose.Types.ObjectId(parentServerId) },
            update: {
              // Добавляем ЛОКАЛЬНЫЕ ID в массив enclosureItems
              $addToSet: {
                enclosureItems: { $each: enclosureLocalIds },
              },
              updatedAt: new Date(),
            },
          },
        };
      }
    );

    if (bulkPremiseUpdateOps.length > 0) {
      await PremiseModel.bulkWrite(bulkPremiseUpdateOps, { session });
    }

    await session.commitTransaction();
    res.json({ successNewDocs, failedNewDocs });
  } catch (error) {
    await session.abortTransaction();
    console.error("Ошибка пакетного создания EnclosureItem:", error);
    res.status(500).json({
      message: "Не удалось выполнить пакетное создание шкафов.",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// --- UPDATE BATCH (Исправлено: использует bulkWrite для эффективности) ---
export const updateBatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const updatedEnclosureItemsBatch = req.body;
  const bulkUpdateOps = [];
  const successfulDocsBeforeExecution = [];
  const failedUpdatedDocs = [];
  const pullFromParents = {}; // { oldParentId: [enclosureId] }
  const pushToParents = {}; // { newParentId: [enclosureId] }

  try {
    // 1. Предварительная загрузка старых документов
    const serverIdsToFind = updatedEnclosureItemsBatch
      .filter((item) => item._id && mongoose.Types.ObjectId.isValid(item._id))
      .map((item) => new mongoose.Types.ObjectId(item._id));

    if (serverIdsToFind.length === 0 && updatedEnclosureItemsBatch.length > 0) {
      updatedEnclosureItemsBatch
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

    const oldDocsMap = await EnclosureItemModel.find({
      _id: { $in: serverIdsToFind },
    })
      .select("_id parent")
      .session(session)
      // !!! ВАЖНОЕ ИСПРАВЛЕНИЕ: Используем .lean() для получения чистых объектов
      .lean()
      .then((docs) =>
        docs.reduce((map, doc) => {
          map[doc._id.toString()] = doc;
          return map;
        }, {})
      );

    // 2. Сбор операций обновления и логики смены родителя
    for (const item of updatedEnclosureItemsBatch) {
      if (!item._id || !mongoose.Types.ObjectId.isValid(item._id)) {
        continue;
      }

      const serverId = new mongoose.Types.ObjectId(item._id);
      const serverIdStr = serverId.toHexString();
      const oldDoc = oldDocsMap[serverIdStr];

      if (!oldDoc) {
        failedUpdatedDocs.push({
          __localId: item.__localId,
          message: `Шкаф с ID ${item._id} не найден.`,
        });
        continue;
      }

      // oldDoc теперь POJO, oldDoc.parent будет чистым ID или null
      // oldDoc.parent может быть null, undefined или ObjectId (чистый, без геттеров)
      const oldParentIdStr = oldDoc.parent ? oldDoc.parent.toString() : null;

      // Используем item.premise из входящих данных
      const newParentIdStr = item.premise || null;

      // Валидация нового ID родителя перед использованием
      const isValidNewParent =
        newParentIdStr && mongoose.Types.ObjectId.isValid(newParentIdStr);

      // Определяем финальный ID родителя для записи в БД
      const finalParentId = isValidNewParent
        ? new mongoose.Types.ObjectId(newParentIdStr)
        : null;

      // Логика перемещения между родителями (Premise)
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

      // Операция обновления самого шкафа
      bulkUpdateOps.push({
        updateOne: {
          filter: { _id: serverId },
          update: {
            $set: {
              title: item.title,
              description: item.description,
              image: item.image || "",
              position: item.position || 0,
              parent: finalParentId,
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

    // 3. Выполнение пакетного обновления шкафов
    let updateResult = { writeErrors: [] };
    if (bulkUpdateOps.length > 0) {
      updateResult = await EnclosureItemModel.bulkWrite(bulkUpdateOps, {
        session,
        ordered: false,
      });
    }

    // 4. Обновление родительских помещений (pull)
    // console.log("pullFromParents", pullFromParents) // Убрано
    const pullOps = Object.keys(pullFromParents).map((parentId) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(parentId) },
        update: {
          $pullAll: { enclosures: pullFromParents[parentId] },
          $set: { updatedAt: new Date() },
        },
      },
    }));
    if (pullOps.length > 0) {
      await PremiseModel.bulkWrite(pullOps, { session });
    }

    // 5. Обновление родительских помещений (push)
    const pushOps = Object.keys(pushToParents).map((parentId) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(parentId) },
        update: {
          $addToSet: { enclosures: { $each: pushToParents[parentId] } },
          $set: { updatedAt: new Date() },
        },
      },
    }));

    if (pushOps.length > 0) {
      await PremiseModel.bulkWrite(pushOps, { session });
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
    console.error("Ошибка пакетного обновления EnclosureItem:", error);
    res.status(500).json({
      message: "Не удалось выполнить пакетное обновление шкафов.",
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

    // 2. Находим шкафы, которые НЕ помечены на удаление
    const enclosureItemsMongoDB = await EnclosureItemModel.find({
      _id: { $in: validIds }, // Ищем по Server ID
      isPendingDeletion: false,
    })
      .select("__localId premise _id")
      .session(session);

    const enclosureItemLocalIDs = enclosureItemsMongoDB.map((e) => e.__localId);

    // 3. Определяем ID, которые уже были удалены (логика фикса)
    const successfullyFoundIds = enclosureItemsMongoDB.map((e) =>
      e._id.toHexString()
    );

    const alreadyDeletedIds = initialValidIdStrings.filter((idString) => {
      return !successfullyFoundIds.includes(idString);
    });

    // 4. Обработка случая, когда нет НОВЫХ шкафов для мягкого удаления
    if (enclosureItemLocalIDs.length === 0) {
      await session.commitTransaction();
      isCommitted = true;

      // Если ни один шкаф не был найден, значит, все они уже удалены/помечены.
      return res.status(200).json({
        success: true,
        message:
          "Все запрошенные шкафы не найдены в базе (возможно, уже удалены).",
        // Все валидные ID считаются "успешно обработанными"
        successDeletedDocIds: initialValidIdStrings,
        failedDeletedDocIds: [],
      });
    }

    // --- 5. КАСКАДНЫЙ ПОИСК ДОЧЕРНИХ ЭЛЕМЕНТОВ (ТОЛЬКО ПОИСК ID) ---

    // 5a. TerminalBlock (Клеммная колодка)
    let terminalBlockLocalIDs = [];
    const terminalBlocksToUpdate = await TerminalBlockModel.find({
      enclosureItem: { $in: enclosureItemLocalIDs },
      isPendingDeletion: false,
    })
      .session(session)
      .select("__localId");

    terminalBlockLocalIDs = terminalBlocksToUpdate.map((doc) => doc.__localId);

    // 5b. Signal (Сигнал)
    let signalLocalIDs = [];
    if (terminalBlockLocalIDs.length > 0) {
      const signalsToUpdate = await SignalModel.find({
        terminalBlock: { $in: terminalBlockLocalIDs },
        isPendingDeletion: false,
      })
        .session(session)
        .select("__localId");
      signalLocalIDs = signalsToUpdate.map((doc) => doc.__localId);
    }

    // --- 6. МЯГКОЕ УДАЛЕНИЕ ДОЧЕРНИХ ЭЛЕМЕНТОВ (СНИЗУ ВВЕРХ) ---

    // 6a. Signal
    if (signalLocalIDs.length > 0) {
      await SignalModel.updateMany(
        { __localId: { $in: signalLocalIDs } },
        { $set: { isPendingDeletion: true, deletedAt: now, updatedAt: now } },
        { session: session }
      );
    }

    // 6b. TerminalBlock
    if (terminalBlockLocalIDs.length > 0) {
      await TerminalBlockModel.updateMany(
        { __localId: { $in: terminalBlockLocalIDs } },
        {
          $set: {
            signals: [],
            isPendingDeletion: true,
            deletedAt: now,
            updatedAt: now,
          },
        },
        { session: session }
      );
    }

    // --- 7. МЯГКОЕ УДАЛЕНИЕ САМИХ ШКАФОВ (EnclosureItem) ---
    const result = await EnclosureItemModel.updateMany(
      { __localId: { $in: enclosureItemLocalIDs } },
      {
        $set: {
          terminalBlocks: [],
          isPendingDeletion: true,
          deletedAt: now,
          updatedAt: now,
        },
      },
      { session }
    );

    // --- 8. ОЧИСТКА РОДИТЕЛЬСКОГО ПОМЕЩЕНИЯ (Premise) ---
    const premiseEnclosureMap = {};
    enclosureItemsMongoDB.forEach((item) => {
      const premiseLocalId = item.premise.toString();
      if (!premiseEnclosureMap[premiseLocalId]) {
        premiseEnclosureMap[premiseLocalId] = [];
      }
      premiseEnclosureMap[premiseLocalId].push(item.__localId);
    });

    const bulkPremisePullOps = Object.keys(premiseEnclosureMap).map(
      (premiseId) => ({
        updateOne: {
          filter: { __localId: new mongoose.Types.ObjectId(premiseId) },
          update: {
            $pullAll: { enclosureItems: premiseEnclosureMap[premiseId] },
            $set: { updatedAt: now },
          },
        },
      })
    );

    if (bulkPremisePullOps.length > 0) {
      await PremiseModel.bulkWrite(bulkPremisePullOps, { session });
    }

    await session.commitTransaction();
    isCommitted = true;

    // 9. Формирование финального ответа

    // ID, которые были успешно помечены на удаление (найдены и обновлены)
    const successfullyMarkedIds = enclosureItemsMongoDB.map((e) =>
      e._id.toHexString()
    );

    // successDeletedDocIds = успешно помеченные ИЛИ те, что уже были удалены (alreadyDeletedIds)
    const finalSuccessIds = [...successfullyMarkedIds, ...alreadyDeletedIds];

    // failedDeletedDocIds: ID, которые не смогли быть обработаны из-за ошибки (здесь они должны быть пусты)
    const finalFailedIds = initialValidIdStrings.filter(
      (id) => !finalSuccessIds.includes(id)
    );

    return res.status(200).json({
      success: true,
      message: `Успешно помечено на удаление ${result.modifiedCount} шкафов и их дочерних элементов. Учтено ${alreadyDeletedIds.length} уже удаленных.`,
      successDeletedDocIds: finalSuccessIds,
      failedDeletedDocIds: finalFailedIds, // Должен быть пустым
    });
  } catch (error) {
    console.error("Ошибка при пакетном мягком удалении EnclosureItem:", error);
    if (session.inTransaction() && !isCommitted) {
      await session.abortTransaction();
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

    const allChanges = await EnclosureItemModel.find({
      $or: [{ createdAt: { $gt: lastSync } }, { updatedAt: { $gt: lastSync } }],
    });

    console.log("allChanges", allChanges);
    const createdOrUpdatedEnclosureItems = allChanges.filter(
      (item) => !item.isPendingDeletion
    );

    const deletedEnclosureItemIds = allChanges
      .filter((item) => item.isPendingDeletion)
      .map((item) => item._id.toHexString());

    const simplifiedItems = createdOrUpdatedEnclosureItems.map((item) => ({
      ...item.toObject(),
      _id: item._id.toHexString(),
      __localId: item.__localId.toHexString(),
    }));

    res.json({
      createdOrUpdatedEnclosureItems: simplifiedItems,
      deletedEnclosureItemIds,
      serverCurrentTimestamp,
    });
  } catch (error) {
    console.error("Ошибка получения изменений для EnclosureItem:", error);
    res.status(500).json({
      message: "Не удалось получить изменения для шкафов.",
      error: error.message,
    });
  }
};

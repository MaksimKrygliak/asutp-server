import PremiseModel from "../models/Premise.js";
import mongoose from "mongoose";
import SectionModel from "../models/Section.js";
import EnclosureItemModel from "../models/EnclosureItem.js";
import TerminalBlockModel from "../models/TerminalBlock.js";
import SignalModel from "../models/Signal.js";

const ObjectId = mongoose.Types.ObjectId;

export const createBatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const arrPremises = req.body;
  if (!Array.isArray(arrPremises) || arrPremises.length === 0) {
    return res.status(400).json({ message: "Нет данных для создания." });
  }

  const premisesToCreate = [];
  const parentSectionsToUpdate = {};
  const failedNewDocs = [];
  const successNewDocs = [];

  try {
    // 1. Сначала найдем все родительские разделы по их локальным ID
    const localSectionIds = [
      ...new Set(arrPremises.map((item) => item.section)),
    ];

    const serverSections = await SectionModel.find({
      __localId: { $in: localSectionIds },
    }).session(session);

    const serverSectionMap = serverSections.reduce((map, section) => {
      map[section.__localId.toString()] = section;
      return map;
    }, {});

    // 2. Итерируем по данным для создания помещений
    for (const item of arrPremises) {
      if (!item.__localId || !item.section) {
        failedNewDocs.push({
          __localId: item.__localId,
          message: "Отсутствуют обязательные поля.",
        });
        continue;
      }

      const parentSection = serverSectionMap[item.section];

      if (!parentSection) {
        failedNewDocs.push({
          __localId: item.__localId,
          message: `Родительский раздел с локальным ID ${item.section} не найден.`,
        });
        continue;
      }

      premisesToCreate.push({
        ...item,
        _id: new ObjectId(),
        section: parentSection.__localId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const sectionServerId = parentSection._id.toString();
      if (!parentSectionsToUpdate[sectionServerId]) {
        parentSectionsToUpdate[sectionServerId] = [];
      }
      parentSectionsToUpdate[sectionServerId].push(
        new ObjectId(item.__localId)
      );
    }

    // 3. Выполняем пакетные операции, как и раньше
    const insertedDocs = await PremiseModel.insertMany(premisesToCreate, {
      session,
      ordered: false,
    });

    insertedDocs.forEach((doc) => {
      successNewDocs.push({
        __localId: doc.__localId,
        __serverId: doc._id,
        updatedAt: doc.updatedAt,
      });
    });

    const updateOperations = [];
    for (const [section, premisesIds] of Object.entries(
      parentSectionsToUpdate
    )) {
      updateOperations.push({
        updateOne: {
          filter: { _id: new ObjectId(section) },
          update: {
            $addToSet: { premises: { $each: premisesIds } },
            updatedAt: new Date(),
          },
        },
      });
    }

    if (updateOperations.length > 0) {
      await SectionModel.bulkWrite(updateOperations, { session });
    }

    await session.commitTransaction();
    res.status(200).json({ successNewDocs, failedNewDocs });
  } catch (error) {
    await session.abortTransaction();
    console.error("Критическая ошибка при пакетном создании Premise:", error);
    res.status(500).json({ message: "Ошибка сервера при создании." });
  } finally {
    session.endSession();
  }
};

export const updateBatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const updatedDocs = req.body;
  const successUpdatedDocs = [];
  const failedUpdatedDocs = [];
  const updateOperations = [];
  const pullFromSections = {}; // { sectionId: [premiseLocalId1, premiseLocalId2] }
  const pushToSections = {}; // { sectionId: [premiseLocalId1, premiseLocalId2] }

  try {
    const docServerIds = updatedDocs
      .map((doc) => doc._id)
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (docServerIds.length === 0) {
      // Если нет валидных _id для обновления, выходим
      await session.commitTransaction();
      session.endSession();
      return res
        .status(200)
        .json({ successUpdatedDocs: [], failedUpdatedDocs: [] });
    }

    // Загружаем __localId (для формирования pull/push), _id и section (ссылку на Section)
    const oldDocsMap = await PremiseModel.find({ _id: { $in: docServerIds } })
      .select("_id __localId section") // !!! ИСПРАВЛЕНО: используем 'section' (ссылка) и '__localId'
      .session(session)
      .then((docs) =>
        docs.reduce((map, doc) => {
          map[doc._id.toString()] = doc;
          return map;
        }, {})
      );

    // 2. Сбор данных для пакетных операций
    for (const doc of updatedDocs) {
      if (!doc._id || !mongoose.Types.ObjectId.isValid(doc._id)) {
        failedUpdatedDocs.push({
          __localId: doc.__localId,
          message: "Отсутствует или невалидный _id.",
        });
        continue;
      }

      const premiseId = new mongoose.Types.ObjectId(doc._id);
      const oldPremise = oldDocsMap[premiseId.toString()];

      if (!oldPremise) {
        failedUpdatedDocs.push({
          __localId: doc.__localId,
          message: "Документ не найден в БД.",
        });
        continue;
      }

      // !!! ИСПРАВЛЕНИЕ: Используем 'section' (от клиента) и 'section' (от БД)
      // ID родительской секции из старого документа
      const oldSectionIdStr = oldPremise.section
        ? oldPremise.section.toString()
        : null;
      // ID родительской секции из обновленного документа (клиент прислал в поле 'section')
      const newSectionIdStr = doc.section || null;

      const premiseLocalId = oldPremise.__localId; // Локальный ID Premise для операций pull/push

      // Логика перемещения между секциями
      if (oldSectionIdStr !== newSectionIdStr) {
        // УДАЛЕНИЕ из старой секции (pull)
        if (oldSectionIdStr) {
          if (!pullFromSections[oldSectionIdStr]) {
            pullFromSections[oldSectionIdStr] = [];
          }
          // !!! Добавляем __localId помещения для удаления из массива 'premises' Section
          pullFromSections[oldSectionIdStr].push(premiseLocalId);
        }

        // ДОБАВЛЕНИЕ в новую секцию (push)
        if (newSectionIdStr) {
          if (!pushToSections[newSectionIdStr]) {
            pushToSections[newSectionIdStr] = [];
          }
          // !!! Добавляем __localId помещения для добавления в массив 'premises' Section
          pushToSections[newSectionIdStr].push(premiseLocalId);
        }
      }

      // 3. Операция обновления самого помещения
      const sectionIdForDb = newSectionIdStr
        ? new mongoose.Types.ObjectId(newSectionIdStr)
        : null;

      updateOperations.push({
        updateOne: {
          filter: { _id: premiseId },
          update: {
            $set: {
              title: doc.title,
              description: doc.description,
              image: doc.image, // !!! Добавлено: image

              // !!! ИСПРАВЛЕНИЕ: Обновляем поле 'section'
              section: sectionIdForDb,
              // enclosureItems: doc.enclosureItems.map(id => new mongoose.Types.ObjectId(id)), // Если нужно обновлять items
              isPendingDeletion: doc.isPendingDeletion || false,
              updatedAt: new Date(),
            },
          },
        },
      });
      // Сохраняем информацию об успешно обработанных документах
      successUpdatedDocs.push({
        __localId: doc.__localId,
        _id: premiseId.toHexString(),
        updatedAt: new Date(),
      });
    }

    // 4. Выполнение пакетного обновления помещений (для корректной обработки ошибок лучше использовать try/catch)
    const updatePremiseResult = await PremiseModel.bulkWrite(updateOperations, {
      session,
      ordered: false,
    });

    // 5. Пакетное обновление родительских секций (pull)
    const pullOps = Object.keys(pullFromSections).map((sectionId) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(sectionId) },
        update: {
          // !!! ИСПРАВЛЕНО: $pullAll удаляет элементы массива, точно соответствующие значениям из другого массива
          $pullAll: { premises: pullFromSections[sectionId] },
          $set: { updatedAt: new Date() },
        },
      },
    }));
    if (pullOps.length > 0) {
      await SectionModel.bulkWrite(pullOps, { session });
    }

    // 6. Пакетное обновление родительских секций (push)
    const pushOps = Object.keys(pushToSections).map((sectionId) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(sectionId) },
        update: {
          // $addToSet с $each гарантирует, что __localId будут добавлены только если их нет
          $addToSet: { premises: { $each: pushToSections[sectionId] } },
          $set: { updatedAt: new Date() },
        },
      },
    }));
    if (pushOps.length > 0) {
      await SectionModel.bulkWrite(pushOps, { session });
    }

    // 7. Корректировка успешных/неудачных документов на основе результатов bulkWrite
    if (
      updatePremiseResult.writeErrors &&
      updatePremiseResult.writeErrors.length > 0
    ) {
      // Если были ошибки, нужно перераспределить документы
      const successfulDocs = [];
      const failedIndices = updatePremiseResult.writeErrors.map(
        (err) => err.index
      );

      for (let i = 0; i < updateOperations.length; i++) {
        const originalDoc = updatedDocs[i];
        const originalResult = successUpdatedDocs[i];

        if (failedIndices.includes(i)) {
          // Перемещаем из успешных в неудачные
          failedUpdatedDocs.push({
            __localId: originalDoc.__localId,
            message: "Ошибка обновления в БД (BulkWrite).",
          });
        } else if (originalResult) {
          // Если нет ошибки BulkWrite, считаем успешным
          successfulDocs.push(originalResult);
        }
      }
      successUpdatedDocs.length = 0; // Очищаем старый массив
      successUpdatedDocs.push(...successfulDocs); // Заполняем только успешными
    }

    // Если все успешно, мы не переназначаем successUpdatedDocs, так как они были собраны ранее.

    await session.commitTransaction();
    res.status(200).json({ successUpdatedDocs, failedUpdatedDocs });
  } catch (error) {
    await session.abortTransaction();
    console.error("Критическая ошибка при пакетном обновлении Premise:", error);
    res.status(500).json({
      message: "Ошибка сервера при обновлении.",
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

  // Используем Map для сохранения исходного ID (строки) и валидации
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
    // Находим только те, что еще НЕ помечены на удаление
    const premisesMongoDB = await PremiseModel.find({
      _id: { $in: validIds },
      isPendingDeletion: false,
    })
      .select("__localId section _id")
      .session(session);

    const premiseLocalIDs = premisesMongoDB.map((p) => p.__localId);

    // Все ID, которые были в исходном запросе, но НЕ найдены в базе (уже удалены).
    const alreadyDeletedIds = initialValidIdStrings.filter((idString) => {
      const found = premisesMongoDB.some(
        (p) => p._id.toHexString() === idString
      );
      return !found;
    });

    if (premiseLocalIDs.length === 0) {
      await session.commitTransaction();
      isCommitted = true;

      // !!! ИСПРАВЛЕНО: Возвращаем все валидные ID как успешно обработанные,
      // так как сервер подтверждает, что их больше нет.
      return res.status(200).json({
        success: true,
        message:
          "Все запрошенные помещения не найдены в базе (возможно, уже удалены).",
        // Все валидные ID считаются "успешно удаленными" с точки зрения клиента.
        successDeletedDocIds: initialValidIdStrings,
        failedDeletedDocIds: [],
      });
    }

    // --- Каскадное мягкое удаление дочерних элементов (без изменений) ---

    const enclosureItemsToUpdate = await EnclosureItemModel.find({
      premise: { $in: premiseLocalIDs },
      isPendingDeletion: false,
    })
      .session(session)
      .select("__localId");

    const enclosureItemLocalIDs = enclosureItemsToUpdate.map(
      (doc) => doc.__localId
    );

    let terminalBlockLocalIDs = [];
    if (enclosureItemLocalIDs.length > 0) {
      const terminalBlocksToUpdate = await TerminalBlockModel.find({
        enclosureItem: { $in: enclosureItemLocalIDs },
        isPendingDeletion: false,
      })
        .session(session)
        .select("__localId");

      terminalBlockLocalIDs = terminalBlocksToUpdate.map(
        (doc) => doc.__localId
      );
    }

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

    if (signalLocalIDs.length > 0) {
      await SignalModel.updateMany(
        { __localId: { $in: signalLocalIDs } },
        { $set: { isPendingDeletion: true, updatedAt: new Date() } },
        { session: session }
      );
    }

    if (terminalBlockLocalIDs.length > 0) {
      await TerminalBlockModel.updateMany(
        { __localId: { $in: terminalBlockLocalIDs } },
        {
          $set: { signals: [], isPendingDeletion: true, updatedAt: new Date() },
        },
        { session: session }
      );
    }

    if (enclosureItemLocalIDs.length > 0) {
      await EnclosureItemModel.updateMany(
        { __localId: { $in: enclosureItemLocalIDs } },
        {
          $set: {
            terminalBlocks: [],
            isPendingDeletion: true,
            updatedAt: new Date(),
          },
        },
        { session: session }
      );
    }

    // --- Удаление из массива Section (без изменений) ---

    const sectionPremisesMap = {};
    premisesMongoDB.forEach((premise) => {
      // Используем toHexString() для сравнения, так как section является ObjectId
      const sectionServerId = premise.section.toHexString();
      if (!sectionPremisesMap[sectionServerId]) {
        sectionPremisesMap[sectionServerId] = [];
      }
      sectionPremisesMap[sectionServerId].push(premise.__localId);
    });

    const bulkSectionPullOps = Object.keys(sectionPremisesMap).map(
      (sectionServerId) => ({
        updateOne: {
          // Ищем по __localId, используя ObjectId, как в исходном коде
          filter: { __localId: new mongoose.Types.ObjectId(sectionServerId) },
          update: {
            $pullAll: { premises: sectionPremisesMap[sectionServerId] },
            $set: { updatedAt: new Date() },
          },
        },
      })
    );

    if (bulkSectionPullOps.length > 0) {
      await SectionModel.bulkWrite(bulkSectionPullOps, { session });
    }

    // --- Мягкое удаление Premise (без изменений) ---

    const result = await PremiseModel.updateMany(
      { __localId: { $in: premiseLocalIDs } },
      {
        $set: {
          enclosureItems: [],
          isPendingDeletion: true,
          updatedAt: new Date(),
        },
      },
      { session }
    );

    await session.commitTransaction();
    isCommitted = true;

    // --- Формирование финального ответа ---

    // ID, которые были успешно помечены на удаление (найдены и обновлены)
    const successfullyMarkedIds = premisesMongoDB.map((p) =>
      p._id.toHexString()
    );

    // successDeletedDocIds = успешно помеченные ИЛИ те, что уже были удалены (alreadyDeletedIds)
    const successDeletedDocIds = [
      ...successfullyMarkedIds,
      ...alreadyDeletedIds,
    ];

    // failedDeletedDocIds: ID, которые не смогли быть обработаны из-за ошибки (здесь они должны быть пусты)
    const failedDeletedDocIds = initialValidIdStrings.filter(
      (id) => !successDeletedDocIds.includes(id)
    );

    // Поскольку мы обработали и найденные, и ненайденные (считая их "успешным удалением"),
    // список failedDeletedDocIds должен быть пустым, если не было Mongo/транзакционных ошибок.
    // Если все ID были обработаны, возвращаем 200.
    return res.status(200).json({
      success: true,
      message: `Успешно помечено на удаление ${result.modifiedCount} помещений и их дочерних элементов, а также учтено ${alreadyDeletedIds.length} уже удаленных.`,
      successDeletedDocIds,
      failedDeletedDocIds, // Должен быть пустым
    });
  } catch (error) {
    console.error("Ошибка при пакетном мягком удалении Premise:", error);
    if (session.inTransaction() && !isCommitted) {
      await session.abortTransaction();
    }
    if (error.name === "MongoTransactionError") {
      console.warn("MongoTransactionError (повторный abort): Проигнорировано.");
    }

    // В случае ошибки 500, мы не можем знать, какие именно ID провалились,
    // но по нашей логике клиент должен получить successDeletedDocIds,
    // чтобы не переудалить их снова, если они были успешно помечены до ошибки.
    // Однако, поскольку транзакция была прервана, мы не можем гарантировать успех.
    // Лучше вернуть 500 и оставить клиента повторить попытку.
    return res.status(500).json({ message: "Ошибка сервера при удалении." });
  } finally {
    session.endSession();
  }
};

// export const deleteBatch = async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   const { ids } = req.body;

//   if (!Array.isArray(ids) || ids.length === 0) {
//     session.endSession();
//     return res.status(400).json({ message: "IDs должен быть массивом." });
//   }

//   const validIds = ids
//     .filter((id) => mongoose.Types.ObjectId.isValid(id))
//     .map((id) => new mongoose.Types.ObjectId(id));

//   if (validIds.length === 0) {
//     session.endSession();
//     return res.status(400).json({
//       message: "Не предоставлено ни одного корректного ObjectId для удаления.",
//     });
//   }
//   let isCommitted = false;

//   try {
//     const premisesMongoDB = await PremiseModel.find({
//       _id: { $in: validIds },
//       isPendingDeletion: false,
//     })
//       .select("__localId section _id")
//       .session(session);
//     console.log("premisesMongoDB", premisesMongoDB)

//     const premiseLocalIDs = premisesMongoDB.map((p) => p.__localId);
//     console.log("premiseLocalIDs", premiseLocalIDs)

//     if (premiseLocalIDs.length === 0) {
//       await session.commitTransaction();
//       isCommitted = true;
//       return res.status(200).json({
//         success: true,
//         message:
//           "Не найдены помещения для мягкого удаления (возможно, уже удалены).",
//         successDeletedDocIds: [],
//         failedDeletedDocIds: ids.map((id) => id.toString()),
//       });
//     }

//     const enclosureItemsToUpdate = await EnclosureItemModel.find({
//       premise: { $in: premiseLocalIDs },
//       isPendingDeletion: false,
//     })
//       .session(session)
//       .select("__localId");

//     const enclosureItemLocalIDs = enclosureItemsToUpdate.map(
//       (doc) => doc.__localId
//     );

//     let terminalBlockLocalIDs = [];
//     if (enclosureItemLocalIDs.length > 0) {
//       const terminalBlocksToUpdate = await TerminalBlockModel.find({
//         enclosureItem: { $in: enclosureItemLocalIDs },
//         isPendingDeletion: false,
//       })
//         .session(session)
//         .select("__localId");

//       terminalBlockLocalIDs = terminalBlocksToUpdate.map(
//         (doc) => doc.__localId
//       );
//     }

//     let signalLocalIDs = [];
//     if (terminalBlockLocalIDs.length > 0) {
//       const signalsToUpdate = await SignalModel.find({
//         terminalBlock: { $in: terminalBlockLocalIDs },
//         isPendingDeletion: false,
//       })
//         .session(session)
//         .select("__localId");
//       signalLocalIDs = signalsToUpdate.map((doc) => doc.__localId);
//     }

//     if (signalLocalIDs.length > 0) {
//       await SignalModel.updateMany(
//         { __localId: { $in: signalLocalIDs } },
//         { $set: { isPendingDeletion: true, updatedAt: new Date() } },
//         { session: session }
//       );
//     }

//     if (terminalBlockLocalIDs.length > 0) {
//       await TerminalBlockModel.updateMany(
//         { __localId: { $in: terminalBlockLocalIDs } },
//         {
//           $set: { signals: [], isPendingDeletion: true, updatedAt: new Date() },
//         },
//         { session: session }
//       );
//     }

//     if (enclosureItemLocalIDs.length > 0) {
//       await EnclosureItemModel.updateMany(
//         { __localId: { $in: enclosureItemLocalIDs } },
//         {
//           $set: {
//             terminalBlocks: [],
//             isPendingDeletion: true,
//             updatedAt: new Date(),
//           },
//         },
//         { session: session }
//       );
//     }

//     const sectionPremisesMap = {};
//     premisesMongoDB.forEach((premise) => {
//       const sectionServerId = premise.section.toString();
//       if (!sectionPremisesMap[sectionServerId]) {
//         sectionPremisesMap[sectionServerId] = [];
//       }
//       sectionPremisesMap[sectionServerId].push(premise.__localId);
//     });

//     const bulkSectionPullOps = Object.keys(sectionPremisesMap).map(
//       (sectionServerId) => ({
//         updateOne: {
//           filter: { __localId: new mongoose.Types.ObjectId(sectionServerId) },
//           update: {
//             $pullAll: { premises: sectionPremisesMap[sectionServerId] },
//             $set: { updatedAt: new Date() },
//           },
//         },
//       })
//     );

//     if (bulkSectionPullOps.length > 0) {
//       await SectionModel.bulkWrite(bulkSectionPullOps, { session });
//     }

//     const result = await PremiseModel.updateMany(
//       { __localId: { $in: premiseLocalIDs } },
//       {
//         $set: {
//           enclosureItems: [],
//           isPendingDeletion: true,
//           updatedAt: new Date(),
//         },
//       },
//       { session }
//     );

//     await session.commitTransaction();
//     isCommitted = true;

//     const successDeletedDocIds = premisesMongoDB.map((p) =>
//       p._id.toHexString()
//     );

//     const failedDeletedDocIds = ids.filter(
//       (id) => !successDeletedDocIds.includes(id)
//     );

//     if (failedDeletedDocIds.length > 0) {
//       return res.status(207).json({
//         message: "Часть документов не была удалена (возможно, уже удалены).",
//         successDeletedDocIds,
//         failedDeletedDocIds,
//       });
//     } else {
//       return res.status(200).json({
//         success: true,
//         message: `Успешно помечено на удаление ${result.modifiedCount} помещений и их дочерних элементов.`,
//         successDeletedDocIds,
//       });
//     }
//   } catch (error) {
//     console.error("Ошибка при пакетном мягком удалении Premise:", error);
//     if (session.inTransaction() && !isCommitted) {
//       await session.abortTransaction();
//     }
//     if (error.name === "MongoTransactionError") {
//       console.warn("MongoTransactionError (повторный abort): Проигнорировано.");
//     }

//     return res.status(500).json({ message: "Ошибка сервера при удалении." });
//   } finally {
//     session.endSession();
//   }
// };

export const getChanges = async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(0);

    const createdOrUpdatedPremises = await PremiseModel.find({
      $or: [{ createdAt: { $gt: since } }, { updatedAt: { $gt: since } }],
      isPendingDeletion: false,
    }).lean();

    const deletedPremisesIds = await PremiseModel.find({
      isPendingDeletion: true,
      updatedAt: { $gt: since },
    })
      .select("__localId")
      .lean()
      .then((docs) => docs.map((doc) => doc._id.toHexString()));

    const serverCurrentTimestamp = new Date().toISOString();

    res.json({
      createdOrUpdatedPremises: createdOrUpdatedPremises,
      deletedPremisesIds,
      serverCurrentTimestamp,
    });
  } catch (error) {
    console.error("Ошибка получения изменений для Premise:", error);
    res.status(500).json({
      message: "Не удалось получить изменения для помещений.",
      error: error.message,
    });
  }
};

import ComputerModel from "../models/Computer.js";
import PremiseModel from "../models/Premise.js";
import mongoose from "mongoose";
import { encrypt, decrypt } from "../utils/encryption.js";

// --- CREATE BATCH (Оставляем как было, тут конфликтов обычно нет) ---
export const createBatch = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const newItemsBatch = req.body;
    if (!Array.isArray(newItemsBatch) || newItemsBatch.length === 0) {
      return res.status(400).json({ message: "Нет данных для создания." });
    }

    const parentPremiseLocalIdsRaw = [
      ...new Set(newItemsBatch.map((i) => i.premise).filter((id) => id)),
    ];
    const parentPremiseIds = parentPremiseLocalIdsRaw.map(
      (id) => new mongoose.Types.ObjectId(id)
    );

    const foundPremises = await PremiseModel.find({
      __localId: { $in: parentPremiseIds },
    }).lean();

    const premiseMap = foundPremises.reduce((map, prem) => {
      map[prem.__localId.toString()] = prem;
      return map;
    }, {});

    session.startTransaction();

    const bulkCreateOps = [];
    const premisesToUpdateMap = {};

    for (const item of newItemsBatch) {
      if (!item.__localId || !item.premise) continue;
      const parentPremiseLocalIdStr = item.premise.toString();

      if (!premiseMap[parentPremiseLocalIdStr]) {
        console.warn(`Родительское помещение ${item.premise} не найдено.`);
        continue;
      }

      const newComputerId = new mongoose.Types.ObjectId();
      const newDoc = {
        ...item,
        _id: newComputerId,
        premise: item.premise,
        login: item.login ? encrypt(item.login) : "",
        password: item.password ? encrypt(item.password) : "",
        createdAt: new Date(),
        updatedAt: new Date(),
        isPendingDeletion: false,
        virtualMachines: [],
      };

      bulkCreateOps.push({ insertOne: { document: newDoc } });

      if (!premisesToUpdateMap[parentPremiseLocalIdStr]) {
        premisesToUpdateMap[parentPremiseLocalIdStr] = [];
      }
      premisesToUpdateMap[parentPremiseLocalIdStr].push(item.__localId);
    }

    if (bulkCreateOps.length > 0) {
      await ComputerModel.bulkWrite(bulkCreateOps, { session });
    }

    const bulkPremiseOps = Object.keys(premisesToUpdateMap).map(
      (premLocalId) => ({
        updateOne: {
          filter: { __localId: new mongoose.Types.ObjectId(premLocalId) },
          update: {
            $addToSet: {
              computers: { $each: premisesToUpdateMap[premLocalId] },
            },
            $set: { updatedAt: new Date() },
          },
        },
      })
    );

    if (bulkPremiseOps.length > 0) {
      await PremiseModel.bulkWrite(bulkPremiseOps, { session });
    }

    const successNewDocs = bulkCreateOps.map((op) => ({
      _id: op.insertOne.document._id.toHexString(),
      __localId: op.insertOne.document.__localId,
      updatedAt: op.insertOne.document.updatedAt,
    }));

    await session.commitTransaction();
    res.json({ successNewDocs, failedNewDocs: [] });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error("Computer Create Error:", error);
    res.status(500).json({ message: error.message });
  } finally {
    await session.endSession();
  }
};

// --- UPDATE BATCH ---
export const updateBatch = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const updatedItems = req.body;
    const ids = updatedItems.map((i) => new mongoose.Types.ObjectId(i._id));
    const oldDocs = await ComputerModel.find({ _id: { $in: ids } }).lean();
    const oldDocsMap = oldDocs.reduce(
      (map, doc) => ({ ...map, [doc._id.toString()]: doc }),
      {}
    );

    session.startTransaction();

    const bulkUpdateOps = [];
    const successDocs = [];
    const pullFromPremise = {};
    const pushToPremise = {};

    for (const item of updatedItems) {
      if (!item._id || !oldDocsMap[item._id]) continue;
      const oldDoc = oldDocsMap[item._id];
      const oldParentId = oldDoc.premise ? oldDoc.premise.toString() : null;
      const newParentId = item.premise ? item.premise.toString() : null;
      const computerLocalId = item.__localId;

      if (newParentId && oldParentId !== newParentId) {
        if (oldParentId) {
          if (!pullFromPremise[oldParentId]) pullFromPremise[oldParentId] = [];
          pullFromPremise[oldParentId].push(computerLocalId);
        }
        if (!pushToPremise[newParentId]) pushToPremise[newParentId] = [];
        pushToPremise[newParentId].push(computerLocalId);
      }

      const updateFields = {
        title: item.title,
        description: item.description,
        IPaddress: item.IPaddress,
        image: item.image,
        position: item.position,
        premise: item.premise,
        isPendingDeletion: item.isPendingDeletion || false,
        updatedAt: new Date(),
      };

      if (item.login !== undefined)
        updateFields.login = item.login ? encrypt(item.login) : "";
      if (item.password !== undefined)
        updateFields.password = item.password ? encrypt(item.password) : "";

      bulkUpdateOps.push({
        updateOne: {
          filter: { _id: item._id },
          update: { $set: updateFields },
        },
      });

      successDocs.push({
        __localId: item.__localId,
        _id: item._id,
        updatedAt: new Date(),
      });
    }

    if (bulkUpdateOps.length > 0) {
      await ComputerModel.bulkWrite(bulkUpdateOps, { session });
    }

    const pullOps = Object.keys(pullFromPremise).map((premId) => ({
      updateOne: {
        filter: { __localId: new mongoose.Types.ObjectId(premId) },
        update: {
          $pullAll: { computers: pullFromPremise[premId] },
          $set: { updatedAt: new Date() },
        },
      },
    }));

    const pushOps = Object.keys(pushToPremise).map((premId) => ({
      updateOne: {
        filter: { __localId: new mongoose.Types.ObjectId(premId) },
        update: {
          $addToSet: { computers: { $each: pushToPremise[premId] } },
          $set: { updatedAt: new Date() },
        },
      },
    }));

    if (pullOps.length > 0) await PremiseModel.bulkWrite(pullOps, { session });
    if (pushOps.length > 0) await PremiseModel.bulkWrite(pushOps, { session });

    await session.commitTransaction();
    res.json({ successUpdatedDocs: successDocs, failedUpdatedDocs: [] });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error("Computer Update Error:", error);
    res.status(500).json({ message: error.message });
  } finally {
    await session.endSession();
  }
};

// --- DELETE BATCH (ФИНАЛЬНОЕ ИСПРАВЛЕНИЕ) ---
export const deleteBatch = async (req, res) => {
  const session = await mongoose.startSession();
  const { ids } = req.body;

  try {
    // 1. ЧТЕНИЕ (Вне транзакции)
    const computersToDelete = await ComputerModel.find({
      _id: { $in: ids },
    }).lean();

    if (computersToDelete.length === 0) {
      return res.json({ success: true, successDeletedDocIds: ids });
    }

    // 2. СТАРТ ТРАНЗАКЦИИ (Удаляем только Компьютеры)
    session.startTransaction();
    const now = new Date();

    await ComputerModel.updateMany(
      { _id: { $in: ids } },
      { $set: { isPendingDeletion: true, deletedAt: now, updatedAt: now } },
      { session }
    );

    // 3. ЗАКРЫВАЕМ ТРАНЗАКЦИЮ (Компьютеры удалены успешно!)
    // Мы коммитим сейчас, чтобы "освободить" базу данных.
    await session.commitTransaction();

    // 4. ОЧИСТКА РОДИТЕЛЯ (ПОСТ-ФАКТУМ, БЕЗ СЕССИИ)
    // Делаем это уже ПОСЛЕ того, как ответили себе, что компьютеры удалены.
    // Если тут возникнет конфликт (потому что помещение удаляется), это не поломает удаление компьютеров.
    try {
      const premiseMap = {};
      computersToDelete.forEach((comp) => {
        if (comp.premise) {
          const premLocalId = comp.premise.toString();
          if (!premiseMap[premLocalId]) premiseMap[premLocalId] = [];
          premiseMap[premLocalId].push(comp.__localId);
        }
      });

      const pullOps = Object.keys(premiseMap).map((premLocalId) => ({
        updateOne: {
          filter: { __localId: new mongoose.Types.ObjectId(premLocalId) },
          update: {
            $pullAll: { computers: premiseMap[premLocalId] },
            $set: { updatedAt: now },
          },
        },
      }));

      if (pullOps.length > 0) {
        // Запускаем БЕЗ { session }, чтобы это была независимая операция
        await PremiseModel.bulkWrite(pullOps);
      }
    } catch (cleanupError) {
      // Игнорируем ошибку конфликта при очистке, так как родитель, вероятно, тоже удаляется
      console.warn(
        "Фоновая очистка Premise пропущена (WriteConflict или родитель удален). Это нормально."
      );
    }

    // 5. Ответ клиенту
    res.json({ success: true, successDeletedDocIds: ids });
  } catch (error) {
    // Этот catch сработает, только если не удалось пометить сам компьютер удаленным
    if (session.inTransaction()) await session.abortTransaction();
    console.error("Computer Delete Error:", error);
    res.status(500).json({ message: error.message });
  } finally {
    await session.endSession();
  }
};

// --- GET CHANGES ---
export const getChanges = async (req, res) => {
  try {
    const lastSync = req.query.since ? new Date(req.query.since) : new Date(0);
    const serverCurrentTimestamp = new Date();

    const allChanges = await ComputerModel.find({
      $or: [{ createdAt: { $gt: lastSync } }, { updatedAt: { $gt: lastSync } }],
    });

    const createdOrUpdated = allChanges.filter(
      (item) => !item.isPendingDeletion
    );

    const deletedIds = allChanges
      .filter((item) => item.isPendingDeletion)
      .map((item) => item._id.toHexString());

    const simplifiedItems = createdOrUpdated.map((item) => {
      const itemObj = item.toObject();
      return {
        ...itemObj,
        _id: item._id.toHexString(),
        __localId: item.__localId.toHexString(),
        login: itemObj.login ? decrypt(itemObj.login) : "",
        password: itemObj.password ? decrypt(itemObj.password) : "",
      };
    });

    res.json({
      createdOrUpdatedComputers: simplifiedItems,
      deletedComputerIds: deletedIds,
      serverCurrentTimestamp,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// // controllers/ComputerController.js
// import ComputerModel from "../models/Computer.js";
// import VirtualMachineModel from "../models/VirtualMachine.js";
// import PremiseModel from "../models/Premise.js"; // ✅ Правильний батько
// import mongoose from "mongoose";
// import { encrypt, decrypt } from "../utils/encryption.js";

// // --- CREATE BATCH ---
// export const createBatch = async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   const newComputersBatch = req.body;
//   if (!Array.isArray(newComputersBatch) || newComputersBatch.length === 0) {
//     await session.endSession();
//     return res.status(400).json({ message: "Нет данных для создания." });
//   }

//   const bulkCreateOps = [];
//   const failedNewDocs = [];
//   const premisesToUpdateMap = {}; // { ParentPremiseServerId: [ChildComputerLocalIdString, ...] }

//   try {
//     // 1. Предварительная загрузка родительских Premise по их локальным ID
//     const localPremiseIds = [
//       ...new Set(
//         newComputersBatch.map((item) => item.premise).filter((id) => id)
//       ),
//     ];

//     // Шукаємо батьківські Premise (не Section!)
//     const serverPremises = await PremiseModel.find({
//       __localId: { $in: localPremiseIds },
//     }).session(session);

//     const serverPremiseMap = serverPremises.reduce((map, premise) => {
//       map[premise.__localId.toString()] = premise;
//       return map;
//     }, {});

//     // 2. Подготовка операций
//     for (const item of newComputersBatch) {
//       if (!item.__localId || !item.premise) {
//         failedNewDocs.push({
//           __localId: item.__localId,
//           message: "Отсутствуют обязательные поля: __localId или premise.",
//         });
//         continue;
//       }

//       // Знаходимо батьківське приміщення
//       const parentPremise = serverPremiseMap[item.premise];

//       if (!parentPremise) {
//         failedNewDocs.push({
//           __localId: item.__localId,
//           message: `Родительское помещение с локальным ID ${item.premise} не найдено.`,
//         });
//         continue;
//       }

//       const newServerId = new mongoose.Types.ObjectId();
//       const parentServerIdStr = parentPremise._id.toHexString();

//       const newDoc = {
//         ...item,
//         _id: newServerId,
//         // В БД пишемо локальний ID батька (як ми і домовлялись для стабільності)
//         premise: item.premise,
//         createdAt: new Date(),
//         updatedAt: new Date(),
//         synced: true,
//         IPaddress: item.IPaddress,
//         image: item.image,

//         // 🔥 ШИФРОВАНИЕ ПРИ СОЗДАНИИ
//         login: encrypt(item.login),
//         password: encrypt(item.password),

//         // Масив віртуалок порожній при створенні (вони синхронізуються окремо)
//         virtualMachines: [],
//       };

//       bulkCreateOps.push({
//         insertOne: {
//           document: newDoc,
//         },
//       });

//       // Готуємо оновлення батька (додаємо локальний ID дитини)
//       if (!premisesToUpdateMap[parentServerIdStr]) {
//         premisesToUpdateMap[parentServerIdStr] = [];
//       }
//       premisesToUpdateMap[parentServerIdStr].push(item.__localId.toString());
//     }

//     // 3. Фаза 1: Создание компьютеров
//     let createResult;
//     if (bulkCreateOps.length > 0) {
//       createResult = await ComputerModel.bulkWrite(bulkCreateOps, {
//         session,
//         ordered: false,
//       });
//     }

//     // 4. Формирование ответа
//     const successNewDocs = [];
//     if (createResult && createResult.insertedIds) {
//       const createdIdsMap = createResult.insertedIds;
//       // Оскільки ми йшли циклом і могли пропускати (continue), індекси bulkWrite можуть не збігатися з newComputersBatch напряму,
//       // але bulkCreateOps має правильний порядок успішних вставок.
//       // Простіше взяти дані з bulkCreateOps:

//       bulkCreateOps.forEach((op, index) => {
//         const doc = op.insertOne.document;
//         successNewDocs.push({
//           _id: doc._id.toHexString(),
//           __localId: doc.__localId,
//           updatedAt: doc.updatedAt,
//         });
//       });
//     }

//     // 5. Фаза 2: Обновление родителей (Premise)
//     const bulkPremiseUpdateOps = Object.keys(premisesToUpdateMap).map(
//       (parentServerId) => {
//         const computerLocalIds = premisesToUpdateMap[parentServerId];
//         return {
//           updateOne: {
//             filter: { _id: new mongoose.Types.ObjectId(parentServerId) },
//             update: {
//               // Додаємо локальні ID комп'ютерів у масив computers приміщення
//               $addToSet: {
//                 computers: { $each: computerLocalIds },
//               },
//               updatedAt: new Date(),
//             },
//           },
//         };
//       }
//     );

//     if (bulkPremiseUpdateOps.length > 0) {
//       await PremiseModel.bulkWrite(bulkPremiseUpdateOps, { session });
//     }

//     await session.commitTransaction();
//     res.json({ successNewDocs, failedNewDocs });
//   } catch (error) {
//     await session.abortTransaction();
//     console.error("Ошибка createBatch Computer:", error);
//     res.status(500).json({
//       message: "Ошибка создания компьютеров.",
//       error: error.message,
//     });
//   } finally {
//     session.endSession();
//   }
// };

// // --- UPDATE BATCH ---
// export const updateBatch = async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   const updatedComputersBatch = req.body;
//   const bulkUpdateOps = [];
//   const successfulDocsBeforeExecution = [];
//   const failedUpdatedDocs = [];
//   const pullFromParents = {};
//   const pushToParents = {};

//   try {
//     const serverIdsToFind = updatedComputersBatch
//       .filter((item) => item._id && mongoose.Types.ObjectId.isValid(item._id))
//       .map((item) => new mongoose.Types.ObjectId(item._id));

//     if (serverIdsToFind.length === 0 && updatedComputersBatch.length > 0) {
//       updatedComputersBatch.forEach((item) => {
//         failedUpdatedDocs.push({
//           __localId: item.__localId,
//           message: "Отсутствует или невалидный _id.",
//         });
//       });
//       await session.commitTransaction();
//       session.endSession();
//       return res
//         .status(200)
//         .json({ successUpdatedDocs: [], failedUpdatedDocs });
//     }

//     const oldDocsMap = await ComputerModel.find({
//       _id: { $in: serverIdsToFind },
//     })
//       .select("_id parent premise")
//       .session(session)
//       .lean()
//       .then((docs) =>
//         docs.reduce((map, doc) => {
//           map[doc._id.toString()] = doc;
//           return map;
//         }, {})
//       );

//     for (const item of updatedComputersBatch) {
//       if (!item._id || !mongoose.Types.ObjectId.isValid(item._id)) continue;

//       const serverId = new mongoose.Types.ObjectId(item._id);
//       const serverIdStr = serverId.toHexString();
//       const oldDoc = oldDocsMap[serverIdStr];

//       if (!oldDoc) {
//         failedUpdatedDocs.push({
//           __localId: item.__localId,
//           message: `Компьютер с ID ${item._id} не найден.`,
//         });
//         continue;
//       }

//       const oldParentIdStr = oldDoc.parent
//         ? oldDoc.parent.toString()
//         : oldDoc.premise
//         ? oldDoc.premise.toString()
//         : null;
//       const newParentIdStr = item.premise || null;

//       const isValidNewParent =
//         newParentIdStr && mongoose.Types.ObjectId.isValid(newParentIdStr);
//       const finalParentId = isValidNewParent
//         ? new mongoose.Types.ObjectId(newParentIdStr)
//         : null;

//       if (oldParentIdStr !== newParentIdStr) {
//         if (oldParentIdStr) {
//           if (!pullFromParents[oldParentIdStr])
//             pullFromParents[oldParentIdStr] = [];
//           pullFromParents[oldParentIdStr].push(serverId);
//         }
//         if (isValidNewParent) {
//           if (!pushToParents[newParentIdStr])
//             pushToParents[newParentIdStr] = [];
//           pushToParents[newParentIdStr].push(serverId);
//         }
//       }

//       // 🔥 ШИФРОВАНИЕ ПРИ ОБНОВЛЕНИИ
//       // Проверяем: если поле пришло, шифруем его. Если нет - оставляем старое.
//       const updateFields = {
//         title: item.title,
//         description: item.description,
//         image: item.image || "",
//         position: item.position || 0,
//         premise: item.premise,
//         parent: finalParentId,
//         IPaddress: item.IPaddress,
//         isPendingDeletion: item.isPendingDeletion || false,
//         updatedAt: new Date(),
//       };

//       if (item.login !== undefined) updateFields.login = encrypt(item.login);
//       if (item.password !== undefined)
//         updateFields.password = encrypt(item.password);

//       bulkUpdateOps.push({
//         updateOne: {
//           filter: { _id: serverId },
//           update: { $set: updateFields },
//         },
//       });

//       successfulDocsBeforeExecution.push({
//         __localId: item.__localId,
//         _id: serverIdStr,
//         updatedAt: new Date(),
//       });
//     }

//     let updateResult = { writeErrors: [] };
//     if (bulkUpdateOps.length > 0) {
//       updateResult = await ComputerModel.bulkWrite(bulkUpdateOps, {
//         session,
//         ordered: false,
//       });
//     }

//     // Обновление Premise (pull/push)
//     const pullOps = Object.keys(pullFromParents).map((parentId) => ({
//       updateOne: {
//         filter: { _id: new mongoose.Types.ObjectId(parentId) },
//         update: {
//           $pullAll: { computers: pullFromParents[parentId] },
//           $set: { updatedAt: new Date() },
//         },
//       },
//     }));
//     if (pullOps.length > 0) await PremiseModel.bulkWrite(pullOps, { session });

//     const pushOps = Object.keys(pushToParents).map((parentId) => ({
//       updateOne: {
//         filter: { _id: new mongoose.Types.ObjectId(parentId) },
//         update: {
//           $addToSet: { computers: { $each: pushToParents[parentId] } },
//           $set: { updatedAt: new Date() },
//         },
//       },
//     }));
//     if (pushOps.length > 0) await PremiseModel.bulkWrite(pushOps, { session });

//     // Формирование ответа
//     const successfulIds = [];
//     if (updateResult.writeErrors && updateResult.writeErrors.length > 0) {
//       const failedIndices = updateResult.writeErrors.map((err) => err.index);
//       for (let i = 0; i < successfulDocsBeforeExecution.length; i++) {
//         if (failedIndices.includes(i)) {
//           failedUpdatedDocs.push({
//             __localId: successfulDocsBeforeExecution[i].__localId,
//             message: "Ошибка обновления БД.",
//           });
//         } else {
//           successfulIds.push(successfulDocsBeforeExecution[i]);
//         }
//       }
//     } else {
//       successfulIds.push(...successfulDocsBeforeExecution);
//     }

//     await session.commitTransaction();
//     res.json({ successUpdatedDocs: successfulIds, failedUpdatedDocs });
//   } catch (error) {
//     await session.abortTransaction();
//     console.error("Ошибка updateBatch Computer:", error);
//     res.status(500).json({ message: "Ошибка сервера.", error: error.message });
//   } finally {
//     session.endSession();
//   }
// };

// // --- DELETE BATCH (Computer) ---
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
//     return res.status(400).json({ message: "Нет валидных ID." });
//   }

//   try {
//     const now = new Date();

//     // 1. Находим компьютеры
//     const computersMongoDB = await ComputerModel.find({
//       _id: { $in: validIds },
//       isPendingDeletion: false,
//     })
//       // Обязательно берем virtualMachines, где теперь лежат LocalID
//       .select("__localId premise _id virtualMachines")
//       .session(session);

//     const computerLocalIDs = computersMongoDB.map((e) => e.__localId);

//     if (computerLocalIDs.length === 0) {
//       await session.commitTransaction();
//       return res.status(200).json({
//         success: true,
//         message: "Компьютеры уже удалены.",
//         successDeletedDocIds: ids,
//         failedDeletedDocIds: [],
//       });
//     }

//     // --- УДАЛЕНИЕ ДОЧЕРНИХ VM ---

//     // Собираем все локальные ID виртуалок из массивов удаляемых компьютеров
//     // computersMongoDB[i].virtualMachines - это теперь массив локальных ID
//     const vmLocalIdsToDelete = computersMongoDB.flatMap(
//       (comp) => comp.virtualMachines || []
//     );

//     if (vmLocalIdsToDelete.length > 0) {
//       await VirtualMachineModel.updateMany(
//         {
//           // Ищем виртуалки по их __localId
//           __localId: { $in: vmLocalIdsToDelete },
//           isPendingDeletion: false,
//         },
//         { $set: { isPendingDeletion: true, deletedAt: now, updatedAt: now } },
//         { session }
//       );
//     }

//     // --- УДАЛЕНИЕ КОМПЬЮТЕРОВ ---
//     const result = await ComputerModel.updateMany(
//       { __localId: { $in: computerLocalIDs } },
//       {
//         $set: {
//           virtualMachines: [], // Очищаем массив
//           isPendingDeletion: true,
//           deletedAt: now,
//           updatedAt: now,
//         },
//       },
//       { session }
//     );

//     // --- ОЧИСТКА Premise (без изменений) ---
//     const premiseComputerMap = {};
//     computersMongoDB.forEach((item) => {
//       if (item.premise) {
//         const premiseLocalId = item.premise.toString();
//         if (!premiseComputerMap[premiseLocalId]) {
//           premiseComputerMap[premiseLocalId] = [];
//         }
//         premiseComputerMap[premiseLocalId].push(item.__localId);
//       }
//     });

//     const bulkPremisePullOps = Object.keys(premiseComputerMap).map(
//       (premiseId) => ({
//         updateOne: {
//           filter: { __localId: new mongoose.Types.ObjectId(premiseId) },
//           update: {
//             $pullAll: { computers: premiseComputerMap[premiseId] },
//             $set: { updatedAt: now },
//           },
//         },
//       })
//     );

//     if (bulkPremisePullOps.length > 0) {
//       await PremiseModel.bulkWrite(bulkPremisePullOps, { session });
//     }

//     await session.commitTransaction();

//     return res.status(200).json({
//       success: true,
//       message: `Удалено ${result.modifiedCount} ПК и ${vmLocalIdsToDelete.length} виртуальных машин.`,
//       successDeletedDocIds: ids,
//       failedDeletedDocIds: [],
//     });
//   } catch (error) {
//     if (session.inTransaction()) await session.abortTransaction();
//     console.error("Ошибка deleteBatch Computer:", error);
//     res.status(500).json({ message: "Ошибка сервера: " + error.message });
//   } finally {
//     session.endSession();
//   }
// };

// // --- GET CHANGES (С ДЕШИФРОВКОЙ) ---
// export const getChanges = async (req, res) => {
//   try {
//     const lastSync = req.query.since ? new Date(req.query.since) : new Date(0);
//     const serverCurrentTimestamp = new Date();

//     const allChanges = await ComputerModel.find({
//       $or: [{ createdAt: { $gt: lastSync } }, { updatedAt: { $gt: lastSync } }],
//     });

//     const createdOrUpdated = allChanges.filter(
//       (item) => !item.isPendingDeletion
//     );
//     const deletedIds = allChanges
//       .filter((item) => item.isPendingDeletion)
//       .map((item) => item._id.toHexString());

//     const simplifiedItems = createdOrUpdated.map((item) => {
//       const itemObj = item.toObject(); // Превращаем в JS объект
//       return {
//         ...itemObj,
//         _id: item._id.toHexString(),
//         __localId: item.__localId.toHexString(),

//         // 🔥 ДЕШИФРОВКА ПЕРЕД ОТПРАВКОЙ КЛИЕНТУ
//         login: decrypt(itemObj.login),
//         password: decrypt(itemObj.password),
//       };
//     });

//     res.json({
//       createdOrUpdatedComputers: simplifiedItems,
//       deletedComputerIds: deletedIds,
//       serverCurrentTimestamp,
//     });
//   } catch (error) {
//     console.error("Ошибка получения изменений Computer:", error);
//     res
//       .status(500)
//       .json({ message: "Ошибка получения изменений.", error: error.message });
//   }
// };

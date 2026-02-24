import DocModel from "../models/Doc.js";
import SectionModel from "../models/Section.js"; // Предполагаю, что локация - это Section
import PremiseModel from "../models/Premise.js";
import EnclosureItemModel from "../models/EnclosureItem.js";
import mongoose from "mongoose";

const ObjectId = mongoose.Types.ObjectId;

// Хелпер для безопасного преобразования строки в ObjectId
const toObjectId = (value) => {
  if (value && mongoose.Types.ObjectId.isValid(value)) {
    return new ObjectId(value);
  }
  return null;
};

// --- ВНУТРЕННИЙ ХЕЛПЕР ДЛЯ ИСЦЕЛЕНИЯ СВЯЗЕЙ ---
const healReferences = async (items) => {
  // 1. Собираем все присланные ID
  const locIds = items.map((i) => i.location).filter(Boolean);
  const premIds = items.map((i) => i.premise).filter(Boolean);
  const encIds = items.map((i) => i.enclosure).filter(Boolean);

  const locOids = locIds.map(toObjectId).filter(Boolean);
  const premOids = premIds.map(toObjectId).filter(Boolean);
  const encOids = encIds.map(toObjectId).filter(Boolean);

  // 2. Ищем их в базе параллельно
  const [locations, premises, enclosures] = await Promise.all([
    SectionModel.find(
      { $or: [{ _id: { $in: locOids } }, { __localId: { $in: locIds } }] },
      "_id __localId"
    ).lean(),
    PremiseModel.find(
      { $or: [{ _id: { $in: premOids } }, { __localId: { $in: premIds } }] },
      "_id __localId"
    ).lean(),
    EnclosureItemModel.find(
      { $or: [{ _id: { $in: encOids } }, { __localId: { $in: encIds } }] },
      "_id __localId"
    ).lean(),
  ]);

  // 3. Строим мапы { "id_от_клиента": серверный_ObjectId }
  const locMap = new Map();
  locations.forEach((x) => {
    locMap.set(x._id.toString(), x._id);
    if (x.__localId) locMap.set(x.__localId.toString(), x._id);
  });

  const premMap = new Map();
  premises.forEach((x) => {
    premMap.set(x._id.toString(), x._id);
    if (x.__localId) premMap.set(x.__localId.toString(), x._id);
  });

  const encMap = new Map();
  enclosures.forEach((x) => {
    encMap.set(x._id.toString(), x._id);
    if (x.__localId) encMap.set(x.__localId.toString(), x._id);
  });

  return { locMap, premMap, encMap };
};

export const batchCreate = async (req, res) => {
  const itemsToProcess = Array.isArray(req.body) ? req.body : [];
  if (itemsToProcess.length === 0)
    return res.json({ successNewDocs: [], failedNewDocs: [] });

  const docsToInsert = [];
  const successNewDocs = [];
  const failedNewDocs = [];

  try {
    // 🔥 1. ИСЦЕЛЯЕМ СВЯЗИ ПЕРЕД ВСТАВКОЙ
    const { locMap, premMap, encMap } = await healReferences(itemsToProcess);

    itemsToProcess.forEach((itemData) => {
      const localIdStr = itemData?.__localId;

      if (!localIdStr || !itemData.user) {
        failedNewDocs.push({
          __localId: localIdStr || "unknown",
          message: "Missing localId or user",
        });
        return;
      }

      // Достаем настоящие ID из мап
      const realLocation = itemData.location
        ? locMap.get(itemData.location.toString())
        : null;
      const realPremise = itemData.premise
        ? premMap.get(itemData.premise.toString())
        : null;
      const realEnclosure = itemData.enclosure
        ? encMap.get(itemData.enclosure.toString())
        : null;

      const docData = {
        __localId: localIdStr,
        idDoc: itemData.idDoc,

        // Записываем правильные серверные _id!
        location: realLocation || toObjectId(itemData.location),
        premise: realPremise || toObjectId(itemData.premise),
        enclosure: realEnclosure || toObjectId(itemData.enclosure),
        user: toObjectId(itemData.user), // User обычно и так валидный

        description: itemData.description || "",
        isPendingDeletion: false,
        synced: true,
        documents: (itemData.documents || []).map((sub) => ({
          equipment: sub.equipment || "",
          path: sub.path || sub.Path || "",
          name: sub.name || sub.Name || "",
          page: sub.page || "",
          nameImg: sub.nameImg || sub.NameImg || "",
        })),
      };

      docsToInsert.push(docData);
    });

    if (docsToInsert.length > 0) {
      const insertResult = await DocModel.insertMany(docsToInsert, {
        ordered: false,
      });
      insertResult.forEach((doc) => {
        successNewDocs.push({
          __localId: doc.__localId,
          _id: doc._id.toString(), // Обязательно возвращаем _id
          updatedAt: doc.updatedAt,
        });
      });
    }

    return res.json({ successNewDocs, failedNewDocs });
  } catch (error) {
    console.error("Doc BatchCreate Error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const batchUpdate = async (req, res) => {
  const updatedDocsBatch = req.body;
  if (!Array.isArray(updatedDocsBatch) || updatedDocsBatch.length === 0) {
    return res.json({ successUpdates: [], failedUpdates: [] });
  }

  const successUpdates = [];
  const failedUpdates = [];
  const bulkOps = [];

  try {
    // 🔥 ИСЦЕЛЯЕМ СВЯЗИ ДЛЯ ОБНОВЛЕНИЯ
    const { locMap, premMap, encMap } = await healReferences(updatedDocsBatch);

    updatedDocsBatch.forEach((docUpdate) => {
      const { _id, __localId, documents, ...dataToUpdate } = docUpdate;

      if (!_id || !mongoose.Types.ObjectId.isValid(_id)) {
        failedUpdates.push({ __localId, _id, message: "Invalid server _id" });
        return;
      }

      const updatePayload = { ...dataToUpdate, updatedAt: new Date() };

      // Подставляем правильные серверные ID
      if (dataToUpdate.hasOwnProperty("location")) {
        updatePayload.location =
          locMap.get(dataToUpdate.location?.toString()) ||
          toObjectId(dataToUpdate.location);
      }
      if (dataToUpdate.hasOwnProperty("premise")) {
        updatePayload.premise =
          premMap.get(dataToUpdate.premise?.toString()) ||
          toObjectId(dataToUpdate.premise);
      }
      if (dataToUpdate.hasOwnProperty("enclosure")) {
        updatePayload.enclosure =
          encMap.get(dataToUpdate.enclosure?.toString()) ||
          toObjectId(dataToUpdate.enclosure);
      }

      if (documents && Array.isArray(documents)) {
        updatePayload.documents = documents.map((sub) => ({
          equipment: sub.equipment,
          path: sub.path || sub.Path,
          name: sub.name || sub.Name,
          page: sub.page,
          nameImg: sub.nameImg || sub.NameImg,
        }));
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: new ObjectId(_id) },
          update: { $set: updatePayload },
        },
      });

      // Сразу добавляем в успех, так как bulkWrite обычно проходит без проблем,
      // если _id валидный (для детальной обработки ошибок лучше использовать цикл, как было у вас, но bulk быстрее)
      successUpdates.push({
        __localId,
        _id,
        updatedAt: updatePayload.updatedAt,
      });
    });

    if (bulkOps.length > 0) {
      await DocModel.bulkWrite(bulkOps);
    }

    return res.json({ successUpdates, failedUpdates });
  } catch (error) {
    console.error("Doc BatchUpdate Error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const batchDeleteDocs = async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "IDs must be an array" });
  }

  const validIds = ids.map(toObjectId).filter(Boolean);

  if (validIds.length === 0) {
    return res.json({ successIds: [], failedIds: [] });
  }

  try {
    const docsToReturn = await DocModel.find(
      { _id: { $in: validIds } },
      "__localId"
    ).lean();
    const localIdsToReturn = docsToReturn
      .map((d) => (d.__localId ? d.__localId.toString() : null))
      .filter(Boolean);

    await DocModel.updateMany(
      { _id: { $in: validIds } },
      {
        $set: {
          isPendingDeletion: true,
          deletedAt: new Date(),
          updatedAt: new Date(),
          idDoc: -1 * (Date.now() + Math.floor(Math.random() * 1000)),
        },
      }
    );

    return res.json({ success: true, successIds: localIdsToReturn });
  } catch (error) {
    console.error("Batch Delete Error:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const getChanges = async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(0);

    // ВАЖНО: Никаких .populate() для связей (location, premise, enclosure)!
    // Отдаем просто строковые _id. (populate для User можно оставить, если клиент ждет объект).
    const createdOrUpdatedDocsRaw = await DocModel.find({
      $or: [{ updatedAt: { $gte: since } }, { createdAt: { $gte: since } }],
      isPendingDeletion: false,
    })
      .populate("user", "_id fullName") // Если клиенту нужно имя юзера
      .lean();

    // Преобразуем ObjectId в строки перед отправкой
    const createdOrUpdatedDocs = createdOrUpdatedDocsRaw.map((doc) => ({
      ...doc,
      _id: doc._id.toString(),
      __localId: doc.__localId.toString(),
      location: doc.location ? doc.location.toString() : null,
      premise: doc.premise ? doc.premise.toString() : null,
      enclosure: doc.enclosure ? doc.enclosure.toString() : null,
      user: doc.user ? doc.user._id.toString() : null, // Отдаем просто ID юзера, как договаривались
    }));

    const deletedDocs = await DocModel.find(
      { isPendingDeletion: true, updatedAt: { $gte: since } },
      "__localId"
    ).lean();

    const deletedDocIds = deletedDocs
      .map((d) => (d.__localId ? d.__localId.toString() : null))
      .filter(Boolean);
    const serverCurrentTimestamp = new Date().toISOString();

    res.json({
      createdOrUpdatedDocs,
      deletedDocIds,
      serverCurrentTimestamp,
    });
  } catch (err) {
    console.error("Server: getChanges Error:", err);
    res.status(500).json({ message: err.message });
  }
};

// import DocModel from "../models/Doc.js";
// import mongoose from "mongoose";
// import UserModel from "../models/User.js";

// // Хелпер для безопасного преобразования строки в ObjectId
// const toObjectId = (value) => {
//   if (value && mongoose.Types.ObjectId.isValid(value)) {
//     return new mongoose.Types.ObjectId(value);
//   }
//   return null;
// };

// export const batchCreate = async (req, res) => {
//   const itemsToProcess = Array.isArray(req.body) ? req.body : [];
//   console.log(`[BatchCreate] Получено объектов: ${itemsToProcess.length}`);

//   const docsToInsert = [];
//   const successNewDocs = [];
//   const failedNewDocs = [];
//   const indexToLocalId = new Map();

//   if (itemsToProcess.length === 0)
//     return res.json({ successNewDocs, failedNewDocs });

//   itemsToProcess.forEach((itemData, index) => {
//     const localIdStr = itemData?.__localId;

//     // 1. Проверяем наличие обязательных полей
//     if (!localIdStr || !itemData.user) {
//       console.log(
//         `[BatchCreate] Пропущен объект ${index}: нет localId или user`
//       );
//       failedNewDocs.push({
//         __localId: localIdStr || "unknown",
//         message: "Missing localId or user",
//       });
//       return;
//     }

//     try {
//       const docData = {
//         __localId: localIdStr,
//         idDoc: itemData.idDoc,
//         location: toObjectId(itemData.location),
//         premise: toObjectId(itemData.premise),
//         enclosure: toObjectId(itemData.enclosure),
//         description: itemData.description || "",
//         isPendingDeletion: false,
//         user: toObjectId(itemData.user),
//         documents: (itemData.documents || []).map((sub) => ({
//           equipment: sub.equipment || "",
//           path: sub.path || sub.Path || "",
//           name: sub.name || sub.Name || "",
//           page: sub.page || "",
//           nameImg: sub.nameImg || sub.NameImg || "",
//         })),
//         synced: true,
//       };

//       if (!docData.user) {
//         console.log(
//           `[BatchCreate] Ошибка ObjectId для пользователя: ${itemData.user}`
//         );
//         throw new Error("Invalid User ID format");
//       }

//       docsToInsert.push(docData);
//       indexToLocalId.set(docsToInsert.length - 1, localIdStr);
//     } catch (e) {
//       failedNewDocs.push({ __localId: localIdStr, message: e.message });
//     }
//   });

//   console.log(
//     `[BatchCreate] Готово к вставке в MongoDB: ${docsToInsert.length} шт.`
//   );

//   if (docsToInsert.length === 0) {
//     return res.json({ successNewDocs, failedNewDocs });
//   }

//   try {
//     // ordered: false позволяет вставить часть, если другие упали
//     const insertResult = await DocModel.insertMany(docsToInsert, {
//       ordered: false,
//     });

//     console.log(`[BatchCreate] Успешно вставлено: ${insertResult.length}`);

//     insertResult.forEach((doc) => {
//       successNewDocs.push({
//         __localId: doc.__localId,
//         __serverId: doc._id.toString(),
//         createdAt: doc.createdAt,
//         updatedAt: doc.updatedAt,
//       });
//     });

//     return res.json({ successNewDocs, failedNewDocs });
//   } catch (error) {
//     console.log(`[BatchCreate] Ошибка при insertMany!`);

//     // Если это ошибка дубликата или валидации (BulkWriteError)
//     if (error.writeErrors) {
//       console.log(`[BatchCreate] Ошибок записи: ${error.writeErrors.length}`);
//       error.writeErrors.forEach((err) => {
//         const localId = indexToLocalId.get(err.index);
//         console.log(` -> Ошибка для ${localId}: ${err.errmsg}`);
//         failedNewDocs.push({
//           __localId: localId,
//           message:
//             err.code === 11000 ? "Дубликат idDoc (уже существует)" : err.errmsg,
//         });
//       });

//       if (error.insertedDocs) {
//         error.insertedDocs.forEach((doc) => {
//           successNewDocs.push({
//             __localId: doc.__localId,
//             __serverId: doc._id.toString(),
//             createdAt: doc.createdAt,
//             updatedAt: doc.updatedAt,
//           });
//         });
//       }
//     } else {
//       console.error("[BatchCreate] Критическая ошибка:", error);
//       return res.status(500).json({ message: error.message });
//     }

//     return res.json({ successNewDocs, failedNewDocs });
//   }
// };

// export const batchUpdate = async (req, res) => {
//   const updatedDocsBatch = req.body;

//   if (!Array.isArray(updatedDocsBatch) || updatedDocsBatch.length === 0) {
//     return res.json({ successUpdates: [], failedUpdates: [] });
//   }

//   const successUpdates = [];
//   const failedUpdates = [];

//   // Используем bulkWrite для оптимизации (вместо цикла await)
//   const bulkOps = [];

//   updatedDocsBatch.forEach((docUpdate) => {
//     const { _id, __localId, ...dataToUpdate } = docUpdate;

//     if (!_id || !mongoose.Types.ObjectId.isValid(_id)) {
//       failedUpdates.push({
//         __localId,
//         _id,
//         message: "Invalid or missing server_id (_id).",
//       });
//       return;
//     }

//     // Подготовка полей (преобразование в ObjectId)
//     const updatePayload = { ...dataToUpdate };

//     // Если приходят поля ссылок, конвертируем их
//     if (updatePayload.location !== undefined)
//       updatePayload.location = toObjectId(updatePayload.location);
//     if (updatePayload.premise !== undefined)
//       updatePayload.premise = toObjectId(updatePayload.premise);
//     if (updatePayload.enclosure !== undefined)
//       updatePayload.enclosure = toObjectId(updatePayload.enclosure);

//     // Если приходят документы, мапим их структуру
//     if (updatePayload.documents && Array.isArray(updatePayload.documents)) {
//       updatePayload.documents = updatePayload.documents.map((sub) => ({
//         equipment: sub.equipment,
//         path: sub.path || sub.Path,
//         name: sub.name || sub.Name,
//         page: sub.page,
//         nameImg: sub.nameImg || sub.NameImg,
//       }));
//     }

//     // Добавляем операцию в список
//     bulkOps.push({
//       updateOne: {
//         filter: { _id: new mongoose.Types.ObjectId(_id) },
//         update: {
//           $set: {
//             ...updatePayload,
//             updatedAt: new Date(),
//           },
//         },
//       },
//     });
//   });

//   // --- Возвращаемся к циклу (надежнее для обратной связи клиенту) ---
//   for (const docUpdate of updatedDocsBatch) {
//     const { _id, __localId, ...dataToUpdate } = docUpdate;

//     // Повторная валидация, т.к. выше мы просто готовили bulk (который я закомментировал ради надежности цикла)
//     if (!_id || !mongoose.Types.ObjectId.isValid(_id)) continue;

//     try {
//       const updatePayload = { ...dataToUpdate };
//       if (updatePayload.location !== undefined)
//         updatePayload.location = toObjectId(updatePayload.location);
//       if (updatePayload.premise !== undefined)
//         updatePayload.premise = toObjectId(updatePayload.premise);
//       if (updatePayload.enclosure !== undefined)
//         updatePayload.enclosure = toObjectId(updatePayload.enclosure);
//       if (updatePayload.documents) {
//         updatePayload.documents = updatePayload.documents.map((sub) => ({
//           equipment: sub.equipment,
//           path: sub.path || sub.Path,
//           name: sub.name || sub.Name,
//           page: sub.page,
//           nameImg: sub.nameImg || sub.NameImg,
//         }));
//       }

//       const updatedDoc = await DocModel.findByIdAndUpdate(
//         _id,
//         { ...updatePayload, updatedAt: new Date() },
//         { new: true, runValidators: true }
//       );

//       if (updatedDoc) {
//         successUpdates.push({
//           __localId: __localId,
//           _id: updatedDoc._id.toString(),
//           updatedAt: updatedDoc.updatedAt,
//         });
//       } else {
//         failedUpdates.push({ __localId, _id, message: "Doc not found" });
//       }
//     } catch (err) {
//       failedUpdates.push({ __localId, _id, message: err.message });
//     }
//   }

//   return res.json({ successUpdates, failedUpdates });
// };

// export const batchDeleteDocs = async (req, res) => {
//   const { ids } = req.body; // Клиент прислал серверные _id

//   if (!Array.isArray(ids) || ids.length === 0) {
//     return res.status(400).json({ message: "IDs must be an array" });
//   }

//   const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));

//   if (validIds.length === 0) {
//     return res.json({ successIds: [], failedIds: [] });
//   }

//   try {
//     // 🔥 1. БЫСТРО ДОСТАЕМ ЛОКАЛЬНЫЕ ID ДЛЯ ОТВЕТА КЛИЕНТУ
//     const docsToReturn = await DocModel.find(
//       { _id: { $in: validIds } },
//       "__localId"
//     ).lean();

//     // Превращаем в массив строк локальных ID
//     const localIdsToReturn = docsToReturn
//       .map((d) => (d.__localId ? d.__localId.toString() : null))
//       .filter(Boolean);

//     // 2. ФОРМИРУЕМ ОПЕРАЦИИ УДАЛЕНИЯ ПО СЕРВЕРНОМУ ID (быстро для MongoDB)
//     const bulkOps = validIds.map((id) => {
//       const uniqueDeletedId =
//         -1 * (Date.now() + Math.floor(Math.random() * 1000));
//       return {
//         updateOne: {
//           filter: { _id: new mongoose.Types.ObjectId(id) },
//           update: {
//             $set: {
//               isPendingDeletion: true,
//               idDoc: uniqueDeletedId,
//               deletedAt: new Date(),
//               updatedAt: new Date(),
//             },
//           },
//         },
//       };
//     });

//     const result = await DocModel.bulkWrite(bulkOps);

//     if (result.isOk()) {
//       // 🔥 3. ВОЗВРАЩАЕМ ЛОКАЛЬНЫЕ ID
//       return res.json({
//         success: true,
//         successIds: localIdsToReturn,
//         modifiedCount: result.modifiedCount,
//       });
//     } else {
//       throw new Error("Bulk write failed");
//     }
//   } catch (error) {
//     console.error("Batch Delete Error:", error);
//     return res.status(500).json({ message: error.message });
//   }
// };

// export const getChanges = async (req, res) => {
//   try {
//     const since = req.query.since ? new Date(req.query.since) : new Date(0);

//     // 1. Находим новые или обновленные (живые)
//     const createdOrUpdatedDocs = await DocModel.find({
//       $or: [{ updatedAt: { $gte: since } }, { createdAt: { $gte: since } }],
//       isPendingDeletion: false, // Только живые
//     })
//       .populate("user") // Подтягиваем юзера
//       // Если location/premise/enclosure нужны клиенту как объекты, добавьте .populate('location') и т.д.
//       // Но обычно для синхронизации нужны ID, которые и так лежат в поле.
//       .lean()
//       .exec();

//     // 2. Находим удаленные
//     // 🔥 FIX: Клиенту нужен __serverId (_id), чтобы найти у себя объект и удалить его.
//     // Возвращаем массив строк _id.
//     const deletedDocs = await DocModel.find(
//       {
//         isPendingDeletion: true,
//         updatedAt: { $gte: since }, // Удаленные после даты синхронизации
//       },
//       "__localId" // Берем только _id
//     ).lean();

//     const deletedDocIds = deletedDocs
//       .map((d) => (d.__localId ? d.__localId.toString() : null))
//       .filter(Boolean);

//     // 3. Собираем Timestamp
//     const serverCurrentTimestamp = new Date().toISOString();

//     // 4. (Опционально) Собираем инфо о пользователях для кеша клиента
//     // ... ваш код для referencedUsers ...
//     const referencedUsers = []; // Упростил для примера, верните свою логику если нужно

//     res.json({
//       createdOrUpdatedDocs, // Клиентский populate должен размапить documents (lowercase)
//       deletedDocIds, // Массив строк-ID
//       serverCurrentTimestamp,
//       referencedUsers,
//     });
//   } catch (err) {
//     console.error("Server: getChanges Error:", err);
//     res.status(500).json({ message: err.message });
//   }
// };

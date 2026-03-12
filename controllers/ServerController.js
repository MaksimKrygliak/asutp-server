import ServerModel from "../models/Server.js";
import PremiseModel from "../models/Premise.js";
import UpsModel from "../models/Ups.js";
import EnclosureItemModel from "../models/EnclosureItem.js"; // 🔥 ДОБАВЛЕН ИМПОРТ ШКАФОВ
import mongoose from "mongoose";
import { universalCascadeDelete } from "../utils/universalCascadeDelete.js";

const ObjectId = mongoose.Types.ObjectId;

const toObjectId = (val) =>
  val && mongoose.Types.ObjectId.isValid(val) ? new ObjectId(val) : null;

// --- 1. CREATE BATCH ---
export const createBatch = async (req, res) => {
  try {
    const newItemsBatch = req.body;
    if (!Array.isArray(newItemsBatch) || newItemsBatch.length === 0) {
      return res.status(400).json({ message: "Нет данных для создания." });
    }

    // ИСЦЕЛЕНИЕ СВЯЗЕЙ С ПОМЕЩЕНИЕМ
    const rawPremiseIds = newItemsBatch.map((i) => i.premise).filter(Boolean);
    const premises = await PremiseModel.find(
      { __localId: { $in: rawPremiseIds } },
      "_id __localId"
    ).lean();
    const premiseMap = new Map();
    premises.forEach((p) => {
      if (p.__localId) premiseMap.set(p.__localId.toString(), p._id);
    });

    // ИСЦЕЛЕНИЕ СВЯЗЕЙ С UPS
    const rawUpsIds = newItemsBatch.map((i) => i.ups).filter(Boolean);
    const upsList = await UpsModel.find(
      { __localId: { $in: rawUpsIds } },
      "_id __localId"
    ).lean();
    const upsMap = new Map();
    upsList.forEach((u) => {
      if (u.__localId) upsMap.set(u.__localId.toString(), u._id);
    });

    // 🔥 ИСЦЕЛЕНИЕ СВЯЗЕЙ СО ШКАФОМ
    const rawEnclosureIds = newItemsBatch
      .map((i) => i.enclosureItem)
      .filter(Boolean);
    const enclosures = await EnclosureItemModel.find(
      { __localId: { $in: rawEnclosureIds } },
      "_id __localId"
    ).lean();
    const enclosureMap = new Map();
    enclosures.forEach((e) => {
      if (e.__localId) enclosureMap.set(e.__localId.toString(), e._id);
    });

    // 3. Подготовка документов
    const docsToInsert = newItemsBatch
      .map((item) => {
        const realPremiseId = item.premise
          ? premiseMap.get(item.premise.toString())
          : null;
        const realUpsId = item.ups ? upsMap.get(item.ups.toString()) : null;
        // 🔥 Достаем ObjectId шкафа
        const realEnclosureId = item.enclosureItem
          ? enclosureMap.get(item.enclosureItem.toString())
          : null;

        return {
          ...item,
          _id: new ObjectId(),
          __localId: toObjectId(item.__localId),
          premise: realPremiseId,
          ups: realUpsId,
          enclosureItem: realEnclosureId, // 🔥 Привязываем к шкафу
          login: item.login || "",
          password: item.password || "",
          createdAt: new Date(),
          updatedAt: new Date(),
          isPendingDeletion: false,
        };
      })
      .filter((doc) => doc !== null);

    if (docsToInsert.length > 0) {
      await ServerModel.insertMany(docsToInsert, { ordered: false });
    }

    const successNewDocs = docsToInsert.map((doc) => ({
      _id: doc._id.toString(),
      __localId: doc.__localId.toString(),
      updatedAt: doc.updatedAt,
    }));

    res.json({ successNewDocs, failedNewDocs: [] });
  } catch (error) {
    console.error("Server Create Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// --- 2. UPDATE BATCH ---
export const updateBatch = async (req, res) => {
  try {
    const updatedItems = req.body;
    if (!Array.isArray(updatedItems) || updatedItems.length === 0) {
      return res.status(400).json({ message: "Нет данных" });
    }

    // ИСЦЕЛЕНИЕ СВЯЗЕЙ С ПОМЕЩЕНИЕМ
    const rawPremiseIds = updatedItems.map((i) => i.premise).filter(Boolean);
    const validPremiseOids = rawPremiseIds.map(toObjectId).filter(Boolean);
    const premises = await PremiseModel.find(
      {
        $or: [
          { _id: { $in: validPremiseOids } },
          { __localId: { $in: rawPremiseIds } },
        ],
      },
      "_id __localId"
    ).lean();
    const premiseMap = new Map();
    premises.forEach((p) => {
      premiseMap.set(p._id.toString(), p._id);
      if (p.__localId) premiseMap.set(p.__localId.toString(), p._id);
    });

    // ИСЦЕЛЕНИЕ СВЯЗЕЙ С UPS
    const rawUpsIds = updatedItems.map((i) => i.ups).filter(Boolean);
    const validUpsOids = rawUpsIds.map(toObjectId).filter(Boolean);
    const upsList = await UpsModel.find(
      {
        $or: [
          { _id: { $in: validUpsOids } },
          { __localId: { $in: rawUpsIds } },
        ],
      },
      "_id __localId"
    ).lean();
    const upsMap = new Map();
    upsList.forEach((u) => {
      upsMap.set(u._id.toString(), u._id);
      if (u.__localId) upsMap.set(u.__localId.toString(), u._id);
    });

    // 🔥 ИСЦЕЛЕНИЕ СВЯЗЕЙ СО ШКАФОМ
    const rawEnclosureIds = updatedItems
      .map((i) => i.enclosureItem)
      .filter(Boolean);
    const validEnclosureOids = rawEnclosureIds.map(toObjectId).filter(Boolean);
    const enclosuresList = await EnclosureItemModel.find(
      {
        $or: [
          { _id: { $in: validEnclosureOids } },
          { __localId: { $in: rawEnclosureIds } },
        ],
      },
      "_id __localId"
    ).lean();
    const enclosureMap = new Map();
    enclosuresList.forEach((e) => {
      enclosureMap.set(e._id.toString(), e._id);
      if (e.__localId) enclosureMap.set(e.__localId.toString(), e._id);
    });

    const bulkUpdateOps = updatedItems.map((item) => {
      const { _id, __localId, ...dataToUpdate } = item;
      const updateFields = { ...dataToUpdate, updatedAt: new Date() };

      if (dataToUpdate.hasOwnProperty("premise")) {
        const realPremiseId = premiseMap.get(dataToUpdate.premise?.toString());
        updateFields.premise =
          realPremiseId || toObjectId(dataToUpdate.premise);
      }

      if (dataToUpdate.hasOwnProperty("ups")) {
        const realUpsId = upsMap.get(dataToUpdate.ups?.toString());
        updateFields.ups = realUpsId || toObjectId(dataToUpdate.ups);
      }

      // 🔥 Подставляем ObjectId шкафа при обновлении
      if (dataToUpdate.hasOwnProperty("enclosureItem")) {
        const realEnclosureId = enclosureMap.get(
          dataToUpdate.enclosureItem?.toString()
        );
        updateFields.enclosureItem =
          realEnclosureId || toObjectId(dataToUpdate.enclosureItem);
      }

      return {
        updateOne: {
          filter: { _id: toObjectId(_id) },
          update: { $set: updateFields },
        },
      };
    });

    if (bulkUpdateOps.length > 0) {
      await ServerModel.bulkWrite(bulkUpdateOps);
    }

    const successUpdatedDocs = updatedItems.map((item) => ({
      __localId: item.__localId,
      _id: item._id,
      updatedAt: new Date(),
    }));

    res.json({ successUpdatedDocs, failedUpdatedDocs: [] });
  } catch (error) {
    console.error("Server Update Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// --- 3. DELETE BATCH (Остается без изменений) ---
export const deleteBatch = async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "ids должен быть массивом." });
  }

  const validObjectIds = ids.map(toObjectId).filter(Boolean);

  if (validObjectIds.length === 0) {
    return res.json({ successIds: [], failedIds: [] });
  }

  try {
    const itemsToReturn = await ServerModel.find(
      { _id: { $in: validObjectIds } },
      "__localId"
    ).lean();
    const localIdsToReturn = itemsToReturn
      .map((i) => (i.__localId ? i.__localId.toString() : null))
      .filter(Boolean);

    await universalCascadeDelete("Server", validObjectIds);

    res.json({ success: true, successIds: localIdsToReturn });
  } catch (error) {
    console.error("Server Delete Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// --- 4. GET CHANGES ---
export const getChanges = async (req, res) => {
  try {
    const lastSync = req.query.since ? new Date(req.query.since) : new Date(0);
    const serverCurrentTimestamp = new Date().toISOString();

    const allChanges = await ServerModel.find({
      $or: [{ createdAt: { $gt: lastSync } }, { updatedAt: { $gt: lastSync } }],
    }).lean();

    const createdOrUpdated = allChanges.filter(
      (item) => !item.isPendingDeletion
    );

    const deletedIds = allChanges
      .filter((item) => item.isPendingDeletion)
      .map((item) => (item.__localId ? item.__localId.toString() : null))
      .filter(Boolean);

    const simplifiedItems = createdOrUpdated.map((item) => ({
      ...item,
      _id: item._id.toString(),
      __localId: item.__localId.toString(),
      premise: item.premise ? item.premise.toString() : null,
      ups: item.ups ? item.ups.toString() : null,
      enclosureItem: item.enclosureItem ? item.enclosureItem.toString() : null, // 🔥 ВОЗВРАЩАЕМ ШКАФ КЛИЕНТУ
    }));

    res.json({
      createdOrUpdatedServers: simplifiedItems,
      deletedServerIds: deletedIds,
      serverCurrentTimestamp,
    });
  } catch (error) {
    console.error("Server GetChanges Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// import ServerModel from "../models/Server.js";
// import PremiseModel from "../models/Premise.js";
// import UpsModel from "../models/Ups.js";
// import mongoose from "mongoose";
// import { universalCascadeDelete } from "../utils/universalCascadeDelete.js";

// const ObjectId = mongoose.Types.ObjectId;

// // Хелпер для безопасной конвертации в ObjectId
// const toObjectId = (val) =>
//   val && mongoose.Types.ObjectId.isValid(val) ? new ObjectId(val) : null;

// // --- 1. CREATE BATCH ---
// export const createBatch = async (req, res) => {
//   try {
//     const newItemsBatch = req.body;
//     if (!Array.isArray(newItemsBatch) || newItemsBatch.length === 0) {
//       return res.status(400).json({ message: "Нет данных для создания." });
//     }

//     // 🔥 ИСЦЕЛЕНИЕ СВЯЗЕЙ: Находим настоящие серверные _id помещений
//     const rawPremiseIds = newItemsBatch.map((i) => i.premise).filter(Boolean);
//     const validPremiseOids = rawPremiseIds.map(toObjectId).filter(Boolean);

//     const premises = await PremiseModel.find(
//       {
//         $or: [
//           { _id: { $in: validPremiseOids } },
//           { __localId: { $in: rawPremiseIds } },
//         ],
//       },
//       "_id __localId"
//     ).lean();

//     const premiseMap = new Map();
//     premises.forEach((p) => {
//       premiseMap.set(p._id.toString(), p._id);
//       if (p.__localId) premiseMap.set(p.__localId.toString(), p._id);
//     });

//     // 🔥 ИСЦЕЛЕНИЕ СВЯЗЕЙ: Находим настоящие серверные _id UPS
//     const rawUpsIds = newItemsBatch.map((i) => i.ups).filter(Boolean);
//     const validUpsOids = rawUpsIds.map(toObjectId).filter(Boolean);

//     const upsList = await UpsModel.find(
//       {
//         $or: [
//           { _id: { $in: validUpsOids } },
//           { __localId: { $in: rawUpsIds } },
//         ],
//       },
//       "_id __localId"
//     ).lean();

//     const upsMap = new Map();
//     upsList.forEach((u) => {
//       upsMap.set(u._id.toString(), u._id);
//       if (u.__localId) upsMap.set(u.__localId.toString(), u._id);
//     });

//     // 3. Подготовка документов
//     const docsToInsert = newItemsBatch
//       .map((item) => {
//         const realPremiseId = item.premise
//           ? premiseMap.get(item.premise.toString())
//           : null;
//         const realUpsId = item.ups ? upsMap.get(item.ups.toString()) : null;

//         // Опционально: если вы не разрешаете создавать сервер без помещения
//         // if (!realPremiseId) return null;

//         return {
//           ...item,
//           _id: new ObjectId(),
//           __localId: toObjectId(item.__localId),
//           premise: realPremiseId,
//           ups: realUpsId, // 100% ПРАВИЛЬНЫЙ СЕРВЕРНЫЙ ID ИЛИ NULL
//           login: item.login || "",
//           password: item.password || "",
//           createdAt: new Date(),
//           updatedAt: new Date(),
//           isPendingDeletion: false,
//         };
//       })
//       .filter((doc) => doc !== null); // Очищаем от null, если пропускали

//     if (docsToInsert.length > 0) {
//       await ServerModel.insertMany(docsToInsert, { ordered: false });
//     }

//     const successNewDocs = docsToInsert.map((doc) => ({
//       _id: doc._id.toString(),
//       __localId: doc.__localId.toString(),
//       updatedAt: doc.updatedAt,
//     }));

//     res.json({ successNewDocs, failedNewDocs: [] });
//   } catch (error) {
//     console.error("Server Create Error:", error);
//     res.status(500).json({ message: error.message });
//   }
// };

// // --- 2. UPDATE BATCH ---
// export const updateBatch = async (req, res) => {
//   try {
//     const updatedItems = req.body;
//     if (!Array.isArray(updatedItems) || updatedItems.length === 0) {
//       return res.status(400).json({ message: "Нет данных" });
//     }

//     // 🔥 ИСЦЕЛЕНИЕ СВЯЗЕЙ С ПОМЕЩЕНИЕМ
//     const rawPremiseIds = updatedItems.map((i) => i.premise).filter(Boolean);
//     const validPremiseOids = rawPremiseIds.map(toObjectId).filter(Boolean);

//     const premises = await PremiseModel.find(
//       {
//         $or: [
//           { _id: { $in: validPremiseOids } },
//           { __localId: { $in: rawPremiseIds } },
//         ],
//       },
//       "_id __localId"
//     ).lean();

//     const premiseMap = new Map();
//     premises.forEach((p) => {
//       premiseMap.set(p._id.toString(), p._id);
//       if (p.__localId) premiseMap.set(p.__localId.toString(), p._id);
//     });

//     // 🔥 ИСЦЕЛЕНИЕ СВЯЗЕЙ С UPS
//     const rawUpsIds = updatedItems.map((i) => i.ups).filter(Boolean);
//     const validUpsOids = rawUpsIds.map(toObjectId).filter(Boolean);

//     const upsList = await UpsModel.find(
//       {
//         $or: [
//           { _id: { $in: validUpsOids } },
//           { __localId: { $in: rawUpsIds } },
//         ],
//       },
//       "_id __localId"
//     ).lean();

//     const upsMap = new Map();
//     upsList.forEach((u) => {
//       upsMap.set(u._id.toString(), u._id);
//       if (u.__localId) upsMap.set(u.__localId.toString(), u._id);
//     });

//     const bulkUpdateOps = updatedItems.map((item) => {
//       const { _id, __localId, ...dataToUpdate } = item;
//       const updateFields = { ...dataToUpdate, updatedAt: new Date() };

//       if (dataToUpdate.hasOwnProperty("premise")) {
//         const realPremiseId = premiseMap.get(dataToUpdate.premise?.toString());
//         updateFields.premise =
//           realPremiseId || toObjectId(dataToUpdate.premise);
//       }

//       if (dataToUpdate.hasOwnProperty("ups")) {
//         const realUpsId = upsMap.get(dataToUpdate.ups?.toString());
//         updateFields.ups = realUpsId || toObjectId(dataToUpdate.ups);
//       }

//       return {
//         updateOne: {
//           filter: { _id: toObjectId(_id) }, // Поиск сервера по серверному _id
//           update: { $set: updateFields },
//         },
//       };
//     });

//     if (bulkUpdateOps.length > 0) {
//       await ServerModel.bulkWrite(bulkUpdateOps);
//     }

//     const successUpdatedDocs = updatedItems.map((item) => ({
//       __localId: item.__localId,
//       _id: item._id,
//       updatedAt: new Date(),
//     }));

//     res.json({ successUpdatedDocs, failedUpdatedDocs: [] });
//   } catch (error) {
//     console.error("Server Update Error:", error);
//     res.status(500).json({ message: error.message });
//   }
// };

// // --- 3. DELETE BATCH (УНИВЕРСАЛЬНЫЙ КАСКАД) ---
// export const deleteBatch = async (req, res) => {
//   const { ids } = req.body; // Получаем серверные ID от GenericSync

//   if (!Array.isArray(ids) || ids.length === 0) {
//     return res.status(400).json({ message: "ids должен быть массивом." });
//   }

//   const validObjectIds = ids.map(toObjectId).filter(Boolean);

//   if (validObjectIds.length === 0) {
//     return res.json({ successIds: [], failedIds: [] });
//   }

//   try {
//     // 1. Достаем __localId серверов для ответа клиенту
//     const itemsToReturn = await ServerModel.find(
//       { _id: { $in: validObjectIds } },
//       "__localId"
//     ).lean();

//     const localIdsToReturn = itemsToReturn
//       .map((i) => (i.__localId ? i.__localId.toString() : null))
//       .filter(Boolean);

//     // 2. 🔥 ВЫЗЫВАЕМ УНИВЕРСАЛЬНУЮ РЕКУРСИЮ!
//     // Она сама найдет VirtualMachine, привязанные к этому серверу, и пометит их на удаление.
//     await universalCascadeDelete("Server", validObjectIds);

//     // Возвращаем правильный ключ successIds
//     res.json({ success: true, successIds: localIdsToReturn });
//   } catch (error) {
//     console.error("Server Delete Error:", error);
//     res.status(500).json({ message: error.message });
//   }
// };

// // --- 4. GET CHANGES ---
// export const getChanges = async (req, res) => {
//   try {
//     const lastSync = req.query.since ? new Date(req.query.since) : new Date(0);
//     const serverCurrentTimestamp = new Date().toISOString();

//     const allChanges = await ServerModel.find({
//       $or: [{ createdAt: { $gt: lastSync } }, { updatedAt: { $gt: lastSync } }],
//     }).lean();

//     const createdOrUpdated = allChanges.filter(
//       (item) => !item.isPendingDeletion
//     );

//     // 🔥 ВОЗВРАЩАЕМ __localId ДЛЯ УДАЛЕННЫХ
//     const deletedIds = allChanges
//       .filter((item) => item.isPendingDeletion)
//       .map((item) => (item.__localId ? item.__localId.toString() : null))
//       .filter(Boolean);

//     const simplifiedItems = createdOrUpdated.map((item) => ({
//       ...item,
//       _id: item._id.toString(),
//       __localId: item.__localId.toString(),
//       premise: item.premise ? item.premise.toString() : null,
//       ups: item.ups ? item.ups.toString() : null,
//     }));

//     res.json({
//       createdOrUpdatedServers: simplifiedItems,
//       deletedServerIds: deletedIds, // Массив локальных ID
//       serverCurrentTimestamp,
//     });
//   } catch (error) {
//     console.error("Server GetChanges Error:", error);
//     res.status(500).json({ message: error.message });
//   }
// };

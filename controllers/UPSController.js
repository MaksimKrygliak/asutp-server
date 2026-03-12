import UpsModel from "../models/Ups.js";
import PremiseModel from "../models/Premise.js";
import EnclosureItemModel from "../models/EnclosureItem.js"; // 🔥 ДОБАВЛЕН ИМПОРТ ШКАФОВ
import mongoose from "mongoose";

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

    // Подготовка документов
    const docsToInsert = newItemsBatch
      .map((item) => {
        const realPremiseId = item.premise
          ? premiseMap.get(item.premise.toString())
          : null;
        // 🔥 Достаем ObjectId шкафа
        const realEnclosureId = item.enclosureItem
          ? enclosureMap.get(item.enclosureItem.toString())
          : null;

        return {
          ...item,
          _id: new ObjectId(),
          __localId: toObjectId(item.__localId),
          premise: realPremiseId,
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
      await UpsModel.insertMany(docsToInsert, { ordered: false });
    }

    const successNewDocs = docsToInsert.map((doc) => ({
      _id: doc._id.toString(),
      __localId: doc.__localId.toString(),
      updatedAt: doc.updatedAt,
    }));

    res.json({ successNewDocs, failedNewDocs: [] });
  } catch (error) {
    console.error("UPS Create Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// --- 2. UPDATE BATCH ---
export const updateBatch = async (req, res) => {
  try {
    const updatedItems = req.body;
    if (!Array.isArray(updatedItems) || updatedItems.length === 0) {
      return res.status(400).json({ message: "Нет данных для обновления." });
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

      // 🔥 Подставляем ObjectId шкафа при обновлении
      if (dataToUpdate.hasOwnProperty("enclosureItem")) {
        const realEnclosureId = enclosureMap.get(
          dataToUpdate.enclosureItem?.toString()
        );
        updateFields.enclosureItem =
          realEnclosureId || toObjectId(dataToUpdate.enclosureItem);
      }

      if (item.login !== undefined) updateFields.login = item.login || "";
      if (item.password !== undefined)
        updateFields.password = item.password || "";

      return {
        updateOne: {
          filter: { _id: toObjectId(_id) },
          update: { $set: updateFields },
        },
      };
    });

    if (bulkUpdateOps.length > 0) {
      await UpsModel.bulkWrite(bulkUpdateOps);
    }

    const successUpdatedDocs = updatedItems.map((item) => ({
      __localId: item.__localId,
      _id: item._id,
      updatedAt: new Date(),
    }));

    res.json({ successUpdatedDocs, failedUpdatedDocs: [] });
  } catch (error) {
    console.error("UPS Update Error:", error);
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
    const now = new Date();

    const upsList = await UpsModel.find(
      { _id: { $in: validObjectIds } },
      "__localId"
    ).lean();
    const localIdsToReturn = upsList
      .map((u) => (u.__localId ? u.__localId.toString() : null))
      .filter(Boolean);

    const disconnectFilter = { ups: { $in: validObjectIds } };
    const disconnectUpdate = { $set: { ups: null, updatedAt: now } };

    await Promise.all([
      mongoose.model("Computer").updateMany(disconnectFilter, disconnectUpdate),
      mongoose.model("Server").updateMany(disconnectFilter, disconnectUpdate),
      mongoose
        .model("EnclosureItem")
        .updateMany(disconnectFilter, disconnectUpdate),
      UpsModel.updateMany(
        { _id: { $in: validObjectIds } },
        { $set: { isPendingDeletion: true, deletedAt: now, updatedAt: now } }
      ),
    ]);

    res.json({ success: true, successIds: localIdsToReturn });
  } catch (error) {
    console.error("UPS Delete Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// --- 4. GET CHANGES ---
export const getChanges = async (req, res) => {
  try {
    const lastSync = req.query.since ? new Date(req.query.since) : new Date(0);
    const serverCurrentTimestamp = new Date().toISOString();

    const allChanges = await UpsModel.find({
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
      enclosureItem: item.enclosureItem ? item.enclosureItem.toString() : null, // 🔥 ВОЗВРАЩАЕМ ШКАФ КЛИЕНТУ
    }));

    res.json({
      createdOrUpdatedUps: simplifiedItems,
      deletedUpsIds: deletedIds,
      serverCurrentTimestamp,
    });
  } catch (error) {
    console.error("UPS GetChanges Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// import UpsModel from "../models/Ups.js";
// import PremiseModel from "../models/Premise.js";
// import mongoose from "mongoose";

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

//     // Подготовка документов
//     const docsToInsert = newItemsBatch
//       .map((item) => {
//         const realPremiseId = item.premise
//           ? premiseMap.get(item.premise.toString())
//           : null;

//         // Опционально: если UPS не может существовать без помещения
//         // if (!realPremiseId) return null;

//         return {
//           ...item,
//           _id: new ObjectId(),
//           __localId: toObjectId(item.__localId),
//           premise: realPremiseId, // 100% ПРАВИЛЬНЫЙ СЕРВЕРНЫЙ ID
//           login: item.login || "",
//           password: item.password || "",
//           createdAt: new Date(),
//           updatedAt: new Date(),
//           isPendingDeletion: false,
//         };
//       })
//       .filter((doc) => doc !== null);

//     if (docsToInsert.length > 0) {
//       await UpsModel.insertMany(docsToInsert, { ordered: false });
//     }

//     const successNewDocs = docsToInsert.map((doc) => ({
//       _id: doc._id.toString(),
//       __localId: doc.__localId.toString(),
//       updatedAt: doc.updatedAt,
//     }));

//     res.json({ successNewDocs, failedNewDocs: [] });
//   } catch (error) {
//     console.error("UPS Create Error:", error);
//     res.status(500).json({ message: error.message });
//   }
// };

// // --- 2. UPDATE BATCH ---
// export const updateBatch = async (req, res) => {
//   try {
//     const updatedItems = req.body;
//     if (!Array.isArray(updatedItems) || updatedItems.length === 0) {
//       return res.status(400).json({ message: "Нет данных для обновления." });
//     }

//     // ИСЦЕЛЕНИЕ СВЯЗЕЙ ДЛЯ ОБНОВЛЕНИЯ
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

//     const bulkUpdateOps = updatedItems.map((item) => {
//       const { _id, __localId, ...dataToUpdate } = item;
//       const updateFields = { ...dataToUpdate, updatedAt: new Date() };

//       if (dataToUpdate.hasOwnProperty("premise")) {
//         const realPremiseId = premiseMap.get(dataToUpdate.premise?.toString());
//         updateFields.premise =
//           realPremiseId || toObjectId(dataToUpdate.premise);
//       }

//       if (item.login !== undefined) updateFields.login = item.login || "";
//       if (item.password !== undefined)
//         updateFields.password = item.password || "";

//       return {
//         updateOne: {
//           filter: { _id: toObjectId(_id) }, // Поиск UPS по серверному ID
//           update: { $set: updateFields },
//         },
//       };
//     });

//     if (bulkUpdateOps.length > 0) {
//       await UpsModel.bulkWrite(bulkUpdateOps);
//     }

//     const successUpdatedDocs = updatedItems.map((item) => ({
//       __localId: item.__localId,
//       _id: item._id,
//       updatedAt: new Date(),
//     }));

//     res.json({ successUpdatedDocs, failedUpdatedDocs: [] });
//   } catch (error) {
//     console.error("UPS Update Error:", error);
//     res.status(500).json({ message: error.message });
//   }
// };

// // --- 3. DELETE BATCH (ОТКЛЮЧЕНИЕ ПИТАНИЯ) ---
// export const deleteBatch = async (req, res) => {
//   const { ids } = req.body; // Получаем СЕРВЕРНЫЕ ID от GenericSync

//   if (!Array.isArray(ids) || ids.length === 0) {
//     return res.status(400).json({ message: "ids должен быть массивом." });
//   }

//   const validObjectIds = ids.map(toObjectId).filter(Boolean);

//   if (validObjectIds.length === 0) {
//     return res.json({ successIds: [], failedIds: [] });
//   }

//   try {
//     const now = new Date();

//     // 1. Быстро достаем локальные ID UPS для ответа клиенту
//     const upsList = await UpsModel.find(
//       { _id: { $in: validObjectIds } },
//       "__localId"
//     ).lean();

//     const localIdsToReturn = upsList
//       .map((u) => (u.__localId ? u.__localId.toString() : null))
//       .filter(Boolean);

//     // 2. 🔥 РАЗРЫВ СВЯЗЕЙ (ОТКЛЮЧЕНИЕ ОБОРУДОВАНИЯ ОТ UPS)
//     // Мы находим все устройства, у которых в поле ups указаны удаляемые бесперебойники, и зануляем это поле.
//     const disconnectFilter = { ups: { $in: validObjectIds } };
//     const disconnectUpdate = { $set: { ups: null, updatedAt: now } };

//     await Promise.all([
//       mongoose.model("Computer").updateMany(disconnectFilter, disconnectUpdate),
//       mongoose.model("Server").updateMany(disconnectFilter, disconnectUpdate),
//       mongoose
//         .model("EnclosureItem")
//         .updateMany(disconnectFilter, disconnectUpdate),

//       // 3. Мягкое удаление самих UPS (Меняем по серверному ID)
//       UpsModel.updateMany(
//         { _id: { $in: validObjectIds } },
//         { $set: { isPendingDeletion: true, deletedAt: now, updatedAt: now } }
//       ),
//     ]);

//     // Возвращаем клиенту __localId
//     res.json({ success: true, successIds: localIdsToReturn });
//   } catch (error) {
//     console.error("UPS Delete Error:", error);
//     res.status(500).json({ message: error.message });
//   }
// };

// // --- 4. GET CHANGES ---
// export const getChanges = async (req, res) => {
//   try {
//     const lastSync = req.query.since ? new Date(req.query.since) : new Date(0);
//     const serverCurrentTimestamp = new Date().toISOString();

//     const allChanges = await UpsModel.find({
//       $or: [{ createdAt: { $gt: lastSync } }, { updatedAt: { $gt: lastSync } }],
//     }).lean();

//     const createdOrUpdated = allChanges.filter(
//       (item) => !item.isPendingDeletion
//     );

//     // 🔥 ИСПРАВЛЕНИЕ: Возвращаем __localId вместо _id
//     const deletedIds = allChanges
//       .filter((item) => item.isPendingDeletion)
//       .map((item) => (item.__localId ? item.__localId.toString() : null))
//       .filter(Boolean);

//     const simplifiedItems = createdOrUpdated.map((item) => ({
//       ...item,
//       _id: item._id.toString(),
//       __localId: item.__localId.toString(),
//       premise: item.premise ? item.premise.toString() : null,
//     }));

//     res.json({
//       createdOrUpdatedUps: simplifiedItems,
//       deletedUpsIds: deletedIds, // Массив строк с локальными ID
//       serverCurrentTimestamp,
//     });
//   } catch (error) {
//     console.error("UPS GetChanges Error:", error);
//     res.status(500).json({ message: error.message });
//   }
// };

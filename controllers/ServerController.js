import ServerModel from "../models/Server.js";
import PremiseModel from "../models/Premise.js";
import UpsModel from "../models/Ups.js";
import EnclosureItemModel from "../models/EnclosureItem.js"; // 🔥 ДОБАВЛЕН ИМПОРТ ШКАФОВ
import mongoose from "mongoose";
import { universalCascadeDelete } from "../utils/universalCascadeDelete.js";
import { deleteOldCloudinaryImage } from "../utils/cloudinaryHelper.js";

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

    // 🔥 ДОБАВЛЕНО: 1. Вытаскиваем старые версии серверов из базы (только поле image)
    const itemIds = updatedItems.map((i) => i._id).filter(Boolean);
    const existingItems = await ServerModel.find(
      { _id: { $in: itemIds.map(toObjectId) } },
      "image"
    ).lean();

    const existingImagesMap = new Map();
    existingItems.forEach((item) => {
      existingImagesMap.set(item._id.toString(), item.image);
    });

    // 🔥 ДОБАВЛЕНО: 2. Сравниваем картинки и собираем промисы на удаление
    const imagesToDeletePromises = [];

    for (const incomingItem of updatedItems) {
      if (!incomingItem._id) continue;

      const oldImage = existingImagesMap.get(incomingItem._id.toString());
      const newImage = incomingItem.image;

      // Если была картинка и она изменилась (или была удалена пользователем)
      if (oldImage && oldImage !== newImage) {
        imagesToDeletePromises.push(deleteOldCloudinaryImage(oldImage));
      }
    }

    // Запускаем фоновое удаление старых картинок из Cloudinary
    if (imagesToDeletePromises.length > 0) {
      await Promise.all(
        imagesToDeletePromises.map((p) => p.catch(console.error))
      );
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

// --- 3. DELETE BATCH ---
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
    // 🔥 ДОБАВЛЕНО: Запрашиваем из базы не только __localId, но и image
    const itemsToReturn = await ServerModel.find(
      { _id: { $in: validObjectIds } },
      "__localId image"
    ).lean();

    const localIdsToReturn = [];
    const imagesToDeletePromises = [];

    // 🔥 ДОБАВЛЕНО: Собираем локальные ID для ответа и картинки для очистки Cloudinary
    itemsToReturn.forEach((item) => {
      if (item.__localId) {
        localIdsToReturn.push(item.__localId.toString());
      }
      if (item.image) {
        imagesToDeletePromises.push(deleteOldCloudinaryImage(item.image));
      }
    });

    // Отправляем запрос на удаление картинок параллельно
    if (imagesToDeletePromises.length > 0) {
      await Promise.all(
        imagesToDeletePromises.map((p) => p.catch(console.error))
      );
    }

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

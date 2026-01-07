import ServerModel from "../models/Server.js";
import PremiseModel from "../models/Premise.js";
import mongoose from "mongoose";
import { encrypt, decrypt } from "../utils/encryption.js";

// --- CREATE BATCH ---
export const createBatch = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const newItemsBatch = req.body;
    if (!Array.isArray(newItemsBatch) || newItemsBatch.length === 0) {
      return res.status(400).json({ message: "Нет данных для создания." });
    }

    // 1. ЧТЕНИЕ (ВНЕ ТРАНЗАКЦИИ) - Чтобы не грузить базу
    const parentPremiseLocalIdsRaw = [
      ...new Set(newItemsBatch.map((i) => i.premise).filter((id) => id)),
    ];

    const parentPremiseIds = parentPremiseLocalIdsRaw.map(
      (id) => new mongoose.Types.ObjectId(id)
    );

    // Ищем родителей
    const foundPremises = await PremiseModel.find({
      __localId: { $in: parentPremiseIds },
    }).lean();

    const premiseMap = foundPremises.reduce((map, prem) => {
      map[prem.__localId.toString()] = prem;
      return map;
    }, {});

    // 2. СТАРТ ТРАНЗАКЦИИ (Только запись)
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

      const newServerId = new mongoose.Types.ObjectId();

      const newDoc = {
        ...item,
        _id: newServerId,
        premise: item.premise,
        // Безопасное шифрование
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
      await ServerModel.bulkWrite(bulkCreateOps, { session });
    }

    const bulkPremiseOps = Object.keys(premisesToUpdateMap).map(
      (premLocalId) => ({
        updateOne: {
          filter: { __localId: new mongoose.Types.ObjectId(premLocalId) },
          update: {
            $addToSet: {
              servers: { $each: premisesToUpdateMap[premLocalId] }, // Поле 'servers'
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
    console.error("Server Create Error:", error);
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

    // 1. ЧТЕНИЕ (ВНЕ ТРАНЗАКЦИИ)
    const ids = updatedItems.map((i) => new mongoose.Types.ObjectId(i._id));
    const oldDocs = await ServerModel.find({ _id: { $in: ids } }).lean();

    const oldDocsMap = oldDocs.reduce(
      (map, doc) => ({ ...map, [doc._id.toString()]: doc }),
      {}
    );

    // 2. СТАРТ ТРАНЗАКЦИИ
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
      const serverLocalId = item.__localId;

      // Перемещение между помещениями
      if (newParentId && oldParentId !== newParentId) {
        if (oldParentId) {
          if (!pullFromPremise[oldParentId]) pullFromPremise[oldParentId] = [];
          pullFromPremise[oldParentId].push(serverLocalId);
        }
        if (!pushToPremise[newParentId]) pushToPremise[newParentId] = [];
        pushToPremise[newParentId].push(serverLocalId);
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
      await ServerModel.bulkWrite(bulkUpdateOps, { session });
    }

    const pullOps = Object.keys(pullFromPremise).map((premId) => ({
      updateOne: {
        filter: { __localId: new mongoose.Types.ObjectId(premId) },
        update: {
          $pullAll: { servers: pullFromPremise[premId] }, // Поле 'servers'
          $set: { updatedAt: new Date() },
        },
      },
    }));

    const pushOps = Object.keys(pushToPremise).map((premId) => ({
      updateOne: {
        filter: { __localId: new mongoose.Types.ObjectId(premId) },
        update: {
          $addToSet: { servers: { $each: pushToPremise[premId] } }, // Поле 'servers'
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
    console.error("Server Update Error:", error);
    res.status(500).json({ message: error.message });
  } finally {
    await session.endSession();
  }
};

// --- DELETE BATCH (ИСПРАВЛЕНО ДЛЯ ОШИБКИ 500) ---
export const deleteBatch = async (req, res) => {
  const session = await mongoose.startSession();
  const { ids } = req.body;

  try {
    // 1. ЧТЕНИЕ (ВНЕ ТРАНЗАКЦИИ)
    // Находим удаляемые серверы, чтобы узнать их родителей
    const serversToDelete = await ServerModel.find({
      _id: { $in: ids },
    }).lean();

    if (serversToDelete.length === 0) {
      return res.json({ success: true, successDeletedDocIds: ids });
    }

    // 2. СТАРТ ТРАНЗАКЦИИ (Только быстрые операции записи)
    session.startTransaction();

    const now = new Date();

    // Мягкое удаление серверов
    await ServerModel.updateMany(
      { _id: { $in: ids } },
      { $set: { isPendingDeletion: true, deletedAt: now, updatedAt: now } },
      { session }
    );

    // Подготовка списка для удаления из родителей
    const premiseMap = {};

    serversToDelete.forEach((srv) => {
      if (srv.premise) {
        const premLocalId = srv.premise.toString();
        if (!premiseMap[premLocalId]) premiseMap[premLocalId] = [];
        premiseMap[premLocalId].push(srv.__localId);
      }
    });

    // Удаляем ID серверов из массивов 'servers' в Помещениях
    const pullOps = Object.keys(premiseMap).map((premLocalId) => ({
      updateOne: {
        filter: { __localId: new mongoose.Types.ObjectId(premLocalId) },
        update: {
          $pullAll: { servers: premiseMap[premLocalId] }, // ВАЖНО: поле 'servers'
          $set: { updatedAt: now },
        },
      },
    }));

    if (pullOps.length > 0) {
      await PremiseModel.bulkWrite(pullOps, { session });
    }

    await session.commitTransaction();
    res.json({ success: true, successDeletedDocIds: ids });
  } catch (error) {
    // Безопасный откат
    if (session.inTransaction()) await session.abortTransaction();
    console.error("Server Delete Error:", error);
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

    const allChanges = await ServerModel.find({
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
      createdOrUpdatedServers: simplifiedItems,
      deletedServerIds: deletedIds,
      serverCurrentTimestamp,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

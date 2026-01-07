import VirtualMachineModel from "../models/VirtualMachine.js";
import ComputerModel from "../models/Computer.js";
import ServerModel from "../models/Server.js";
import mongoose from "mongoose";
import { encrypt, decrypt } from "../utils/encryption.js";

// --- CREATE BATCH ---
export const createBatch = async (req, res) => {
  // Сессия создается, но транзакция пока НЕ начинается
  const session = await mongoose.startSession();

  try {
    const newItemsBatch = req.body;
    if (!Array.isArray(newItemsBatch) || newItemsBatch.length === 0) {
      return res.status(400).json({ message: "Нет данных." });
    }

    // =====================================================================
    // ЭТАП 1: ПОДГОТОВКА ДАННЫХ (Чтение БЕЗ транзакции)
    // Мы делаем это "снаружи", чтобы не держать транзакцию открытой пока ищем
    // =====================================================================

    // 1. Собираем ID
    const parentComputerLocalIdsRaw = [
      ...new Set(newItemsBatch.map((i) => i.computer).filter((id) => id)),
    ];
    const parentServerLocalIdsRaw = [
      ...new Set(newItemsBatch.map((i) => i.server).filter((id) => id)),
    ];

    const parentComputerIds = parentComputerLocalIdsRaw.map(
      (id) => new mongoose.Types.ObjectId(id)
    );
    const parentServerIds = parentServerLocalIdsRaw.map(
      (id) => new mongoose.Types.ObjectId(id)
    );

    // 2. Ищем родителей (БЕЗ session(session), обычный поиск)
    // Это снижает нагрузку на транзакционный движок Mongo
    const [foundComputers, foundServers] = await Promise.all([
      ComputerModel.find({ __localId: { $in: parentComputerIds } }).lean(),
      ServerModel.find({ __localId: { $in: parentServerIds } }).lean(),
    ]);

    const computerMap = foundComputers.reduce((map, item) => {
      map[item.__localId.toString()] = item;
      return map;
    }, {});

    const serverMap = foundServers.reduce((map, item) => {
      map[item.__localId.toString()] = item;
      return map;
    }, {});

    // =====================================================================
    // ЭТАП 2: ТРАНЗАКЦИЯ (Только запись)
    // =====================================================================
    session.startTransaction();

    const bulkCreateOps = [];
    const computersToUpdateMap = {};
    const serversToUpdateMap = {};

    // 3. Обработка данных (в памяти, очень быстро)
    for (const item of newItemsBatch) {
      if (!item.__localId) continue;
      if (!item.computer && !item.server) continue;

      let isComputerParent = false;
      let parentLocalIdStr = null;

      if (item.computer) {
        parentLocalIdStr = item.computer.toString();
        // Используем карту, которую подготовили на Этапе 1
        if (!computerMap[parentLocalIdStr]) {
          console.warn(`Родитель-Компьютер ${item.computer} не найден.`);
          continue;
        }
        isComputerParent = true;
      } else if (item.server) {
        parentLocalIdStr = item.server.toString();
        if (!serverMap[parentLocalIdStr]) {
          console.warn(`Родитель-Сервер ${item.server} не найден.`);
          continue;
        }
        isComputerParent = false;
      }

      const newServerId = new mongoose.Types.ObjectId();

      const newDoc = {
        ...item,
        _id: newServerId,
        computer: item.computer || null,
        server: item.server || null,
        // Безопасное шифрование
        login: item.login ? encrypt(item.login) : "",
        password: item.password ? encrypt(item.password) : "",
        createdAt: new Date(),
        updatedAt: new Date(),
        isPendingDeletion: false,
      };

      bulkCreateOps.push({ insertOne: { document: newDoc } });

      if (isComputerParent) {
        if (!computersToUpdateMap[parentLocalIdStr])
          computersToUpdateMap[parentLocalIdStr] = [];
        computersToUpdateMap[parentLocalIdStr].push(item.__localId);
      } else {
        if (!serversToUpdateMap[parentLocalIdStr])
          serversToUpdateMap[parentLocalIdStr] = [];
        serversToUpdateMap[parentLocalIdStr].push(item.__localId);
      }
    }

    // 4. Запись в БД (Быстро, внутри транзакции)
    if (bulkCreateOps.length > 0) {
      await VirtualMachineModel.bulkWrite(bulkCreateOps, { session });
    }

    // 5. Обновление родителей
    const bulkComputerOps = Object.keys(computersToUpdateMap).map(
      (compLocalId) => ({
        updateOne: {
          filter: { __localId: new mongoose.Types.ObjectId(compLocalId) },
          update: {
            $addToSet: {
              virtualMachines: { $each: computersToUpdateMap[compLocalId] },
            },
            $set: { updatedAt: new Date() },
          },
        },
      })
    );

    const bulkServerOps = Object.keys(serversToUpdateMap).map(
      (servLocalId) => ({
        updateOne: {
          filter: { __localId: new mongoose.Types.ObjectId(servLocalId) },
          update: {
            $addToSet: {
              virtualMachines: { $each: serversToUpdateMap[servLocalId] },
            },
            $set: { updatedAt: new Date() },
          },
        },
      })
    );

    if (bulkComputerOps.length > 0)
      await ComputerModel.bulkWrite(bulkComputerOps, { session });
    if (bulkServerOps.length > 0)
      await ServerModel.bulkWrite(bulkServerOps, { session });

    // Успех
    const successNewDocs = bulkCreateOps.map((op) => ({
      _id: op.insertOne.document._id.toHexString(),
      __localId: op.insertOne.document.__localId,
      updatedAt: op.insertOne.document.updatedAt,
    }));

    await session.commitTransaction();
    res.json({ successNewDocs, failedNewDocs: [] });
  } catch (error) {
    // Безопасная отмена
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error("VM Create Error:", error);
    res.status(500).json({ message: error.message });
  } finally {
    await session.endSession();
  }
};

// --- UPDATE BATCH ---
export const updateBatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const updatedItems = req.body;
  const bulkUpdateOps = [];
  const successDocs = [];

  const pullFromComp = {};
  const pushToComp = {};
  const pullFromServer = {};
  const pushToServer = {};

  try {
    const ids = updatedItems.map((i) => new mongoose.Types.ObjectId(i._id));
    const oldDocs = await VirtualMachineModel.find({ _id: { $in: ids } })
      .session(session)
      .lean();
    const oldDocsMap = oldDocs.reduce(
      (map, doc) => ({ ...map, [doc._id.toString()]: doc }),
      {}
    );

    for (const item of updatedItems) {
      if (!item._id || !oldDocsMap[item._id]) continue;
      const oldDoc = oldDocsMap[item._id];
      const vmLocalId = item.__localId;

      let oldParentType = "none";
      let oldParentId = null;

      if (oldDoc.computer) {
        oldParentType = "pc";
        oldParentId = oldDoc.computer.toString();
      } else if (oldDoc.server) {
        oldParentType = "server";
        oldParentId = oldDoc.server.toString();
      }

      let newParentType = "none";
      let newParentId = null;

      if (item.computer) {
        newParentType = "pc";
        newParentId = item.computer.toString();
      } else if (item.server) {
        newParentType = "server";
        newParentId = item.server.toString();
      } else {
        if (item.computer === undefined && item.server === undefined) {
          newParentType = oldParentType;
          newParentId = oldParentId;
        }
      }

      const parentChanged =
        oldParentType !== newParentType || oldParentId !== newParentId;

      if (parentChanged) {
        if (oldParentType === "pc" && oldParentId) {
          if (!pullFromComp[oldParentId]) pullFromComp[oldParentId] = [];
          pullFromComp[oldParentId].push(vmLocalId);
        } else if (oldParentType === "server" && oldParentId) {
          if (!pullFromServer[oldParentId]) pullFromServer[oldParentId] = [];
          pullFromServer[oldParentId].push(vmLocalId);
        }

        if (newParentType === "pc" && newParentId) {
          if (!pushToComp[newParentId]) pushToComp[newParentId] = [];
          pushToComp[newParentId].push(vmLocalId);
        } else if (newParentType === "server" && newParentId) {
          if (!pushToServer[newParentId]) pushToServer[newParentId] = [];
          pushToServer[newParentId].push(vmLocalId);
        }
      }

      const updateFields = {
        title: item.title,
        description: item.description,
        IPaddress: item.IPaddress,
        image: item.image,
        position: item.position,
        computer: newParentType === "pc" ? item.computer : null,
        server: newParentType === "server" ? item.server : null,
        isPendingDeletion: item.isPendingDeletion || false,
        updatedAt: new Date(),
      };

      // 🔥 ИСПРАВЛЕНИЕ: Безопасное обновление шифрования
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
      await VirtualMachineModel.bulkWrite(bulkUpdateOps, { session });
    }

    const createParentOps = (map, model, type) => {
      return Object.keys(map).map((parentId) => ({
        updateOne: {
          filter: { __localId: new mongoose.Types.ObjectId(parentId) },
          update: {
            [type]: {
              virtualMachines:
                type === "$pullAll" ? map[parentId] : { $each: map[parentId] },
            },
            $set: { updatedAt: new Date() },
          },
        },
      }));
    };

    const pullCompOps = createParentOps(
      pullFromComp,
      ComputerModel,
      "$pullAll"
    );
    const pushCompOps = createParentOps(pushToComp, ComputerModel, "$addToSet");
    const pullServOps = createParentOps(
      pullFromServer,
      ServerModel,
      "$pullAll"
    );
    const pushServOps = createParentOps(pushToServer, ServerModel, "$addToSet");

    if (pullCompOps.length)
      await ComputerModel.bulkWrite(pullCompOps, { session });
    if (pushCompOps.length)
      await ComputerModel.bulkWrite(pushCompOps, { session });
    if (pullServOps.length)
      await ServerModel.bulkWrite(pullServOps, { session });
    if (pushServOps.length)
      await ServerModel.bulkWrite(pushServOps, { session });

    await session.commitTransaction();
    res.json({ successUpdatedDocs: successDocs, failedUpdatedDocs: [] });
  } catch (error) {
    await session.abortTransaction();
    console.error("VM Update Error:", error);
    res.status(500).json({ message: error.message });
  } finally {
    session.endSession();
  }
};

export const deleteBatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const { ids } = req.body;

  try {
    const now = new Date();
    const vmsToDelete = await VirtualMachineModel.find({
      _id: { $in: ids },
    }).session(session);

    if (vmsToDelete.length === 0) {
      await session.commitTransaction();
      return res.json({ success: true, successDeletedDocIds: ids });
    }

    await VirtualMachineModel.updateMany(
      { _id: { $in: ids } },
      { $set: { isPendingDeletion: true, deletedAt: now, updatedAt: now } },
      { session }
    );

    const compMap = {};
    const servMap = {};

    vmsToDelete.forEach((vm) => {
      if (vm.computer) {
        const pid = vm.computer.toString();
        if (!compMap[pid]) compMap[pid] = [];
        compMap[pid].push(vm.__localId);
      }
      if (vm.server) {
        const pid = vm.server.toString();
        if (!servMap[pid]) servMap[pid] = [];
        servMap[pid].push(vm.__localId);
      }
    });

    const pullCompOps = Object.keys(compMap).map((pid) => ({
      updateOne: {
        filter: { __localId: new mongoose.Types.ObjectId(pid) },
        update: {
          $pullAll: { virtualMachines: compMap[pid] },
          $set: { updatedAt: now },
        },
      },
    }));

    const pullServOps = Object.keys(servMap).map((pid) => ({
      updateOne: {
        filter: { __localId: new mongoose.Types.ObjectId(pid) },
        update: {
          $pullAll: { virtualMachines: servMap[pid] },
          $set: { updatedAt: now },
        },
      },
    }));

    if (pullCompOps.length > 0)
      await ComputerModel.bulkWrite(pullCompOps, { session });
    if (pullServOps.length > 0)
      await ServerModel.bulkWrite(pullServOps, { session });

    await session.commitTransaction();
    res.json({ success: true, successDeletedDocIds: ids });
  } catch (error) {
    await session.abortTransaction();
    console.error("VM Delete Error:", error);
    res.status(500).json({ message: error.message });
  } finally {
    session.endSession();
  }
};

export const getChanges = async (req, res) => {
  try {
    const lastSync = req.query.since ? new Date(req.query.since) : new Date(0);
    const serverCurrentTimestamp = new Date();

    const allChanges = await VirtualMachineModel.find({
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
        computer: itemObj.computer ? itemObj.computer.toString() : null,
        server: itemObj.server ? itemObj.server.toString() : null,

        // 🔥 ИСПРАВЛЕНИЕ: Безопасная расшифровка
        login: itemObj.login ? decrypt(itemObj.login) : "",
        password: itemObj.password ? decrypt(itemObj.password) : "",
      };
    });

    res.json({
      createdOrUpdatedVMs: simplifiedItems,
      deletedVMIds: deletedIds,
      serverCurrentTimestamp,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

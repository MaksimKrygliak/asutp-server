import VirtualMachineModel from "../models/VirtualMachine.js";
import ComputerModel from "../models/Computer.js";
import ServerModel from "../models/Server.js";
import mongoose from "mongoose";

const ObjectId = mongoose.Types.ObjectId;

// --- 1. CREATE BATCH ---
export const createBatch = async (req, res) => {
  try {
    const newItemsBatch = req.body;
    if (!Array.isArray(newItemsBatch) || newItemsBatch.length === 0) {
      return res.status(400).json({ message: "Нет данных для создания." });
    }

    // 1. Собираем уникальные локальные ID потенциальных родителей
    const localCompIds = [
      ...new Set(newItemsBatch.map((i) => i.computer).filter((id) => id)),
    ];
    const localServIds = [
      ...new Set(newItemsBatch.map((i) => i.server).filter((id) => id)),
    ];

    // 2. Ищем серверные _id родителей в БД
    const [foundComps, foundServs] = await Promise.all([
      ComputerModel.find({
        __localId: { $in: localCompIds.map((id) => new ObjectId(id)) },
      })
        .select("_id __localId")
        .lean(),
      ServerModel.find({
        __localId: { $in: localServIds.map((id) => new ObjectId(id)) },
      })
        .select("_id __localId")
        .lean(),
    ]);

    // Создаем карты соответствия
    const compMap = foundComps.reduce(
      (map, c) => ({ ...map, [c.__localId.toString()]: c._id }),
      {}
    );
    const servMap = foundServs.reduce(
      (map, s) => ({ ...map, [s.__localId.toString()]: s._id }),
      {}
    );

    // 3. Подготовка документов
    const docsToInsert = newItemsBatch
      .map((item) => {
        // Пытаемся найти серверный ID родителя (либо ПК, либо Сервер)
        const parentCompId = item.computer
          ? compMap[item.computer.toString()]
          : null;
        const parentServId = item.server
          ? servMap[item.server.toString()]
          : null;

        // Если в данных был родитель, но мы не нашли его в БД — пропускаем, чтобы не было "сирот"
        if (
          (item.computer && !parentCompId) ||
          (item.server && !parentServId)
        ) {
          console.warn(
            `Родитель для VM ${item.__localId} не найден на сервере.`
          );
          return null;
        }

        return {
          ...item,
          _id: new ObjectId(),
          __localId: new ObjectId(item.__localId),
          computer: parentCompId,
          server: parentServId,
          login: item.login || "",
          password: item.password || "",
          createdAt: new Date(),
          updatedAt: new Date(),
          isPendingDeletion: false,
        };
      })
      .filter((doc) => doc !== null);

    if (docsToInsert.length > 0) {
      await VirtualMachineModel.insertMany(docsToInsert, { ordered: false });
    }

    const successNewDocs = docsToInsert.map((doc) => ({
      _id: doc._id.toString(),
      __localId: doc.__localId.toString(),
      updatedAt: doc.updatedAt,
    }));

    res.json({ successNewDocs, failedNewDocs: [] });
  } catch (error) {
    console.error("VM Create Error:", error);
    res.status(500).json({ message: "Ошибка при создании виртуальных машин." });
  }
};

// --- 2. UPDATE BATCH ---
export const updateBatch = async (req, res) => {
  try {
    const updatedItems = req.body;
    if (!Array.isArray(updatedItems) || updatedItems.length === 0) {
      return res.status(400).json({ message: "Нет данных для обновления." });
    }

    const bulkUpdateOps = updatedItems.map((item) => {
      const { _id, __localId, ...dataToUpdate } = item;

      const updateFields = {
        ...dataToUpdate,
        updatedAt: new Date(),
      };

      // Конвертируем ID родителей, если они пришли в теле (после PULL они уже серверные)
      if (dataToUpdate.computer)
        updateFields.computer = new ObjectId(dataToUpdate.computer);
      if (dataToUpdate.server)
        updateFields.server = new ObjectId(dataToUpdate.server);

      if (item.login !== undefined) updateFields.login = item.login || "";
      if (item.password !== undefined)
        updateFields.password = item.password || "";

      return {
        updateOne: {
          filter: { _id: new ObjectId(_id) },
          update: { $set: updateFields },
        },
      };
    });

    if (bulkUpdateOps.length > 0) {
      await VirtualMachineModel.bulkWrite(bulkUpdateOps);
    }

    const successUpdatedDocs = updatedItems.map((item) => ({
      __localId: item.__localId,
      _id: item._id,
      updatedAt: new Date(),
    }));

    res.json({ successUpdatedDocs, failedUpdatedDocs: [] });
  } catch (error) {
    console.error("VM Update Error:", error);
    res
      .status(500)
      .json({ message: "Ошибка при обновлении виртуальных машин." });
  }
};

// --- 3. DELETE BATCH (Мягкое удаление по localIds) ---
// --- 3. DELETE BATCH (Мягкое удаление по серверным _id) ---
export const deleteBatch = async (req, res) => {
  // Принимаем 'ids', так как GenericSync шлет именно этот ключ
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "ids должен быть массивом." });
  }

  try {
    const now = new Date();
    // Фильтруем валидные ObjectId, чтобы избежать ошибок кастинга
    const serverObjectIds = ids
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new ObjectId(id));

    if (serverObjectIds.length === 0) {
      return res.json({ success: true, successIds: [] });
    }

    // 🔥 ИЩЕМ ПО _id (серверному), так как фронтенд шлет sId
    const result = await VirtualMachineModel.updateMany(
      { _id: { $in: serverObjectIds } },
      { $set: { isPendingDeletion: true, deletedAt: now, updatedAt: now } }
    );

    console.log(`Удалено (soft delete) VM: ${result.modifiedCount}`);

    // Возвращаем successIds, чтобы GenericSync понял, что удаление подтверждено
    res.json({
      success: true,
      successIds: ids,
    });
  } catch (error) {
    console.error("VM Delete Error:", error);
    res.status(500).json({ message: "Ошибка сервера при удалении VM." });
  }
};

// --- 4. GET CHANGES ---
export const getChanges = async (req, res) => {
  try {
    const lastSync = req.query.since ? new Date(req.query.since) : new Date(0);
    const serverCurrentTimestamp = new Date().toISOString();

    // Оптимизируем запрос: убираем $or, так как updatedAt покрывает и создание
    const allChanges = await VirtualMachineModel.find({
      updatedAt: { $gt: lastSync },
    }).lean();

    const createdOrUpdated = allChanges.filter(
      (item) => !item.isPendingDeletion
    );

    // 🔥 ИСПРАВЛЕНИЕ: Собираем именно __localId удаленных объектов
    const deletedVMIds = allChanges
      .filter((item) => item.isPendingDeletion)
      .map((doc) => (doc.__localId ? doc.__localId.toString() : null))
      .filter(Boolean); // Убираем null, если вдруг затесались

    const simplifiedItems = createdOrUpdated.map((item) => ({
      ...item,
      _id: item._id.toString(),
      __localId: item.__localId.toString(),
      computer: item.computer ? item.computer.toString() : null,
      server: item.server ? item.server.toString() : null,
      login: item.login || "",
      password: item.password || "",
    }));

    res.json({
      createdOrUpdatedVMs: simplifiedItems,
      deletedVMIds, // Теперь здесь массив локальных ID (UUID/ObjectId)
      serverCurrentTimestamp,
    });
  } catch (error) {
    console.error("VM GetChanges Error:", error);
    res.status(500).json({ message: "Не удалось получить изменения." });
  }
};

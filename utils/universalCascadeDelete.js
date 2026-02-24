import mongoose from "mongoose";

// 🔥 КАРТА СВЯЗЕЙ (DEPENDENCY GRAPH)
const CASCADE_GRAPH = {
  Section: [{ modelName: "Premise", foreignKey: "section" }],
  Premise: [
    { modelName: "Server", foreignKey: "premise" },
    { modelName: "Computer", foreignKey: "premise" },
    { modelName: "EnclosureItem", foreignKey: "premise" },
    { modelName: "Ups", foreignKey: "premise" },
  ],
  EnclosureItem: [{ modelName: "TerminalBlock", foreignKey: "enclosureItem" }],
  Server: [{ modelName: "VirtualMachine", foreignKey: "server" }],
  Computer: [{ modelName: "VirtualMachine", foreignKey: "computer" }],
  TerminalBlock: [{ modelName: "Signal", foreignKey: "terminalBlock" }],
};

/**
 * Универсальная рекурсивная функция для каскадного Soft Delete в MongoDB
 */
export const universalCascadeDelete = async (
  modelName,
  ids,
  visited = new Set()
) => {
  if (!ids || ids.length === 0) return;

  // 1. Отфильтровываем ID, которые уже удаляли (защита от циклов)
  const newIds = [];
  for (const id of ids) {
    const idStr = id.toString();
    if (!visited.has(idStr)) {
      visited.add(idStr);
      newIds.push(id);
    }
  }

  if (newIds.length === 0) return;

  // 2. Помечаем ТЕКУЩИЙ уровень как удаленный
  const Model = mongoose.model(modelName);
  const now = new Date();

  // 🔥 ИСПРАВЛЕНИЕ: { $ne: true } ловит и false, и отсутствие поля!
  await Model.updateMany(
    { _id: { $in: newIds }, isPendingDeletion: { $ne: true } },
    { $set: { isPendingDeletion: true, deletedAt: now, updatedAt: now } }
  );

  // 3. Идем вглубь по графу (РЕКУРСИЯ)
  const childrenConfigs = CASCADE_GRAPH[modelName] || [];

  for (const config of childrenConfigs) {
    try {
      const ChildModel = mongoose.model(config.modelName);

      // 🔥 ИСПРАВЛЕНИЕ: Ищем детей тоже с условием { $ne: true }
      const children = await ChildModel.find(
        {
          [config.foreignKey]: { $in: newIds },
          isPendingDeletion: { $ne: true },
        },
        "_id"
      ).lean();

      const childIds = children.map((c) => c._id);

      // Если дети найдены — рекурсивно вызываем удаление для них
      if (childIds.length > 0) {
        await universalCascadeDelete(config.modelName, childIds, visited);
      }
    } catch (e) {
      console.error(
        `Ошибка при каскадном удалении детей ${config.modelName}:`,
        e
      );
    }
  }
};

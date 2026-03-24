import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const AssetRequestItemHistory = sequelize.define(
  "AssetRequestItemHistory",
  {
    history_id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
      collate: "utf8mb4_bin",
    },

    original_item_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
    },

    req_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
    },

    asset_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
    },

    requested_qty: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    to_purchase_qty: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    spare_item: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    spare_status: {
      type: DataTypes.ENUM("PENDING", "REQUESTED", "APPROVED", "REJECTED"),
      allowNull: false,
      defaultValue: "PENDING",
    },

    spare_remarks: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    servicing_status: {
      type: DataTypes.ENUM("PENDING", "APPROVED", "REJECTED"),
      allowNull: true,
    },

    servicing_requested_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    servicing_reviewed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    servicing_remarks: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    servicing_outcome: {
      type: DataTypes.ENUM("COMPLETED", "SCRAPPED"),
      allowNull: true,
    },

    servicing_completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    service_person_name: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    service_person_mobile: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },

    tracking_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    company_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
    },

    action_type: {
      type: DataTypes.ENUM(
        "CREATED",
        "UPDATED",
        "MERGED",
        "RECEIVED",
        "DELETED",
      ),
      allowNull: false,
    },
  },
  {
    tableName: "asset_request_items_history",
    timestamps: true,
    createdAt: "action_at",
    updatedAt: false,
    charset: "utf8mb4",
    collate: "utf8mb4_bin",
  },
);

/* ================= ASSOCIATIONS ================= */

AssetRequestItemHistory.associate = (models) => {
  AssetRequestItemHistory.belongsTo(models.Asset, {
    foreignKey: "asset_id",
    as: "asset",
  });

  AssetRequestItemHistory.belongsTo(models.Company, {
    foreignKey: "company_id",
    as: "company",
  });
};

export default AssetRequestItemHistory;

/* eslint-disable @typescript-eslint/no-unused-vars */
import { Column, Table, DataType, PrimaryKey } from "sequelize-typescript";
import { DocumentPermission } from "@shared/types";
import BaseModel from "./base/BaseModel";
import Fix from "./decorators/Fix";

@Table({ tableName: "document_init", modelName: "document_init" })
@Fix
class DocumentInit extends BaseModel {
  @PrimaryKey
  @Column(DataType.UUID)
  id: string;

  @Column(DataType.UUID)
  collectionId: string;

  @Column(DataType.BOOLEAN)
  isUpdated: string;
}

export default DocumentInit;

/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Column,
  ForeignKey,
  BelongsTo,
  Default,
  IsIn,
  Table,
  DataType,
  Scopes,
  PrimaryKey,
} from "sequelize-typescript";
import { DocumentPermission } from "@shared/types";
import BaseModel from "./base/BaseModel";
import Fix from "./decorators/Fix";

@Table({ tableName: "document_user", modelName: "document_user" })
@Fix
class DocumentUser extends BaseModel {
  @Default(DocumentPermission.ReadWrite)
  @IsIn([Object.values(DocumentPermission)])
  @Column(DataType.STRING)
  permission: DocumentPermission;

  @PrimaryKey
  @Column(DataType.UUID)
  id: string;

  @Column(DataType.UUID)
  documentid: string;

  @Column(DataType.UUID)
  userid: string;

  @Column(DataType.UUID)
  collectionid: string;
}

export default DocumentUser;

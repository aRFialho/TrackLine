export type OrderStatus = "ABERTA" | "FINALIZADA";
export type OperationStatus = "PENDENTE" | "CONCLUIDA";

export type Sector = {
  id: string;
  name: string;
};

export type Employee = {
  id: string;
  name: string;
  sectorIds: string[];
};

export type WorkSchedule = {
  workStart: string;
  workEnd: string;
  lunchStart: string;
  lunchEnd: string;
};

export type ItemOperation = {
  sectorId: string;
  employeeId?: string;
  status: OperationStatus;
  releasedAt: string;
  startedAt?: string;
  finishedAt?: string;
  usefulMinutes?: number;
};

export type ProductionItem = {
  id: string;
  quantity: number;
  unit: string;
  description: string;
  operations: ItemOperation[];
};

export type ProductionOrder = {
  id: string;
  number: string;
  name: string;
  createdAt: string;
  openedAt: string;
  finishedAt?: string;
  status: OrderStatus;
  items: ProductionItem[];
};

export type NotificationAction =
  | "CONFIRM_OPERATION"
  | "UNCONFIRM_OPERATION"
  | "ROLLBACK_OPERATION"
  | "BATCH_OPERATION";

export type ProductionNotification = {
  id: string;
  action: NotificationAction;
  actorEmail: string;
  orderNumber: string;
  itemId: string;
  itemDescription: string;
  quantity: number;
  unit: string;
  sectorName: string;
  employeeName?: string;
  rollbackReason?: string;
  batchMode?: "SINGLE_ITEM" | "FULL_LOT" | "CUSTOM_QUANTITY";
  requestedQuantity?: number;
  processedQuantity?: number;
  createdAt: string;
};

export type BatchOperationMode = "SINGLE_ITEM" | "FULL_LOT" | "CUSTOM_QUANTITY";

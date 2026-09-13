import { InventoryMovementType } from '@prisma/client';
import { MOVEMENT_EFFECT, MOVEMENT_TYPE_LABELS } from './inventory.types';

describe('inventory movement semantics', () => {
  it('defines an effect for every movement type in the schema', () => {
    const schemaTypes = Object.values(InventoryMovementType);
    const covered = Object.keys(MOVEMENT_EFFECT);

    expect(covered.sort()).toEqual([...schemaTypes].sort());
  });

  it('labels every movement type for the dashboard', () => {
    const schemaTypes = Object.values(InventoryMovementType);
    expect(Object.keys(MOVEMENT_TYPE_LABELS).sort()).toEqual([...schemaTypes].sort());
  });

  it('adds stock on inbound movements', () => {
    expect(MOVEMENT_EFFECT.STOCK_IN.stock).toBe(1);
    expect(MOVEMENT_EFFECT.RETURN.stock).toBe(1);
  });

  it('removes stock on outbound movements', () => {
    expect(MOVEMENT_EFFECT.STOCK_OUT.stock).toBe(-1);
    expect(MOVEMENT_EFFECT.SALE.stock).toBe(-1);
  });

  it('moves only the reserved counter for reservations, leaving stock on hand alone', () => {
    expect(MOVEMENT_EFFECT.RESERVATION).toEqual({ stock: 0, reserved: 1 });
    expect(MOVEMENT_EFFECT.RELEASE).toEqual({ stock: 0, reserved: -1 });
  });
});

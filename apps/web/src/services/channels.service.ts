import { http, unwrap } from './http';
import type { ChannelConnection } from '@/types/channels';
import type { ChannelType } from '@/types/crm';

export interface CreateChannelPayload {
  type: ChannelType;
  name: string;
  externalId: string;
  accessToken: string;
}

export interface UpdateChannelPayload {
  name?: string;
  accessToken?: string;
  isActive?: boolean;
}

export const channelsService = {
  list: () => unwrap<ChannelConnection[]>(http.get('/channels')),

  create: (payload: CreateChannelPayload) =>
    unwrap<ChannelConnection>(http.post('/channels', payload)),

  update: (id: string, payload: UpdateChannelPayload) =>
    unwrap<ChannelConnection>(http.patch(`/channels/${id}`, payload)),

  verify: (id: string) => unwrap<ChannelConnection>(http.post(`/channels/${id}/verify`)),

  remove: (id: string) => unwrap<null>(http.delete(`/channels/${id}`)),
};

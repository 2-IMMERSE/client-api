### Setup

app2app socket setup and pairing is as in HbbTV.

Once paired, messages can be sent from companion to TV or vice versa.

### Syntax

All messages are JSON.

All messages have a `type` field which indicates the message type.

The field(s) used for the message body vary depending on the type (and where applicable, subtype) of the message.
Message body fields are indicated in the tables below.

### Messages: Both directions

| `type` field     | message body fields              | notes                                          |
| ---------------- | -------------------------------- | ---------------------------------------------- |
| device           | `value` = sender's device ID     | SHOULD be sent on pairing                      |
| instance         | `value` = sender's instance ID   | SHOULD be sent on pairing                      |
| app2appMsgBus    | various: see section below       | various: see section below                     |


### Messages: TV --> Companion

| `type` field                | message body fields                  | notes                                                                                                                |
| -------------------------   | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| context                     | `value` = Context ID (or null)       | Context ID. SHOULD be sent on pairing and on change                                                                  |
| dmApp                       | `value` = DMApp ID (or null)         | DMApp ID. SHOULD be sent on pairing and on change                                                                    |
| interContext                | `value` = Inter Context ID (or null) | Inter-context ID. SHOULD be sent on pairing and on change                                                            |
| session                     | `value` = Session ID (or null)       | Session ID. SHOULD be sent on pairing and on change                                                                  |
| setMode                     | `value` = Mode signal variable       | Mode signal (this is not the same as the TV vs companion mode). SHOULD be sent on pairing (if defined) and on change |
| app2appSyncEvent            | `subtype` = sync event type          | Only sent after app2appSyncCtl received                                                                              |
| serviceUrls                 | `value` = service URL object         | Listing of service URLs used on the TV. SHOULD be sent on pairing                                                    |
| localDevGroupErrorSummary   | `value` = error summary              | Summary of error state of all devices in local group. SHOULD be sent on pairing and on change                        |
| sharedSignalChange          | `key` = signal name, `value` = value | Sent only for signals subscribed using *subscribeSharedSignals*                                                      |
| mergedPerDeviceSignalChange | `key` = signal name, `value` = value | Sent only for signals subscribed using *subscribeMergedPerDeviceSignals*                                             |
| setAllAuxData               | `value` = auxiliary data object      | TV auxiliary discovery data object                                                                                   |

After a companion device receives a *context*, *dmApp*, *interContext*, or *session* message, it SHOULD join or leave the context, DMApp, inter-context group, or session respectively.


app2appSyncEvent event types:

| `subtype` field  | notes                                                    |
| ---------------- | -------------------------------------------------------- |
| available        | A notification that the clock has become available       |
| unavailable      | A notification that the clock has become unavailable     |
| change           | A timestamp update indicating a notifiable change        |
| update           | A regular timestamp update                               |


Message subtypes: *available*, *change*, *update*, additionally have the following fields.

| field            | unit     | notes                                                             |
| ---------------- | -------- | ----------------------------------------------------------------- |
| speed            | relative | Normal speed = 1, paused = 0, other values MAY be sent            |
| time             | s        | Timestamps do not include correction for network or other delays  |

A companion device MUST assume that the clock is unavailable until a subtype *available* message is received.

When the app2app socket is disconnected/unpaired, the sync state becomes *unavailable*, even if the socket is later reconnected.

If the clock at the TV is available when the socket is later reconnected and re-paired, it MAY send a further *available* message
after it receives a suitable *app2appSyncCtl* message.


### Messages: Companion --> TV

| `type` field                      | message body fields                          | notes                                                          |
| --------------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| app2appSyncCtl                    | `sync` = boolean                             | Set to true to request app2app sync messages from TV           |
| errorSummary                      | `value` = error summary                      | Summary of error state of companion device                     |
| subscribeSharedSignals            | `keys` = array of signal names               | Subscribe to shared signals with given keys/names              |
| unsubscribeSharedSignals          | `keys` = array of signal names               | Unsubscribe from shared signals with given keys/names          |
| subscribeMergedPerDeviceSignals   | `keys` = array of signal names               | Subscribe to merged per-device signals with given keys/names   |
| unsubscribeMergedPerDeviceSignals | `keys` = array of signal names               | Unsubscribe to merged per-device signals with given keys/names |
| setPerDeviceSignal                | `key` = signal name, `value` = value         | Notify update of value of single per-device signal             |
| setAllPerDeviceSignals            | `signals` = array of signal name/value pairs | Notify names/values of all per-device signals                  |

Any sync enabled by use of the *app2appSyncCtl* message only persists as long as the socket remains connected and paired.

Any signal subscriptions enabled by use of the *subscribeSharedSignals* and *subscribeMergedPerDeviceSignals* messages only persists as long as the socket remains connected and paired.


### Messages: TV emulator app2app server --> TV (after pairing complete)

| `type` field     | message body fields             | notes                                                       |
| ---------------- | ------------------------------- | ----------------------------------------------------------- |
| remoteAddr       | `address` = IP, `port` = port   | Address of companion device app2app socket                  |


### Message type: app2appMsgBus

Messages of this type are used for messaging between devices/components using the app2app channel.
Messages of this type have the following additional fields.

| field            | type      | notes                                                                     |
| ---------------- | --------- | ------------------------------------------------------------------------- |
| subtype          | string    | 'msg' for outgoing messages, 'ack' or 'nack' for replies, see below       |
| msgId            | string    | Message ID, replies use the same ID as the outgoing message               |
| body             | arbitrary | Message contents, of an arbitrary type, used for 'msg' and 'ack' subtypes |
| error            | object    | Negative acknowledgement message, used for 'nack' subtype, see below      |
| toDeviceId       | string    | Target device ID of this message                                          |
| toComponentId    | string    | Target component ID of this message, not used for replies                 |
| fromDeviceId     | string    | Source device ID of this message, not used for replies                    |
| fromComponentId  | string    | Optional source component ID of this message, not used for replies        |

| `subtype` field  | notes                                                    |
| ---------------- | -------------------------------------------------------- |
| msg              | Outgoing message                                         |
| ack              | Reply message: positive acknowledgement                  |
| nack             | Reply message: negative acknowledgement                  |

'nack' subtype messages may be sent by intermediary devices/components if the target device/component is not reachable.

| `error` object fields | type      | notes                                                                          |
| --------------------- | --------- | ------------------------------------------------------------------------------ |
| type                  | string    | Type of negative acknowledgement/error, see below                              |
| deviceId              | string    | Device ID emitting the 'nack' message, not necessarily the destination         |
| componentId           | string    | Component ID emitting the 'nack' message, used for 'component_error' type      |
| body                  | arbitrary | Message contents, of an arbitrary type, used for 'component_error' type        |
| msg                   | string    | Message text, used for types other than 'component_error'                      |

| `error` object `type` field | notes                                                                          |
| --------------------------- | ------------------------------------------------------------------------------ |
| component_error             | Error emitted by receiving component                                           |
| config_error                | Configuration error                                                            |
| send_timeout                | Send timeout                                                                   |
| no_route_to_device          | No route to device                                                             |
| component_not_found         | Component not found on device                                                  |
| exception                   | Exception thrown                                                               |

Component IDs may be suffixed with zero or more '/'-separated sub-component parts. This is for routing within components and/or to sub-components.

The device and component ID fields may also take the special values listed below:

| Device ID        | notes                                                              |
| ---------------- | ------------------------------------------------------------------ |
| @self            | The current device, this value is never sent as it is device-local |
| @master          | The master device                                                  |

| Component ID     | notes                                                              |
| ---------------- | ------------------------------------------------------------------ |
| *echo            | Echo service: Returns an 'ack' with the same message body          |

Special/debug operation component IDs are generally prefixed with two '*' characters.

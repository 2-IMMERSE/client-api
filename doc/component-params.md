## Component parameters

The Layout protocol defines a 'parameters' object in the 'DMAppComponent' schema which can be used to specify component-specific parameters.
See api/types/dmapp-component.raml in the layout-service repository.

This documents the available parameters for components defined within this repo, along with their 'class' field.

### Video component

This has a 'class' field of 'video'.

Available parameters:
* `mediaUrl`: optional string of the video media URL to play.
  This may be an MP4 file or other media file type directly playable in a video tag, or it may be a DASH manifest which has a file extension of '.mpd'.
  If this is changed after construction playback will switch to the new URL, if null/undefined/empty no video will play.
* `auxMediaUrl`: optional string of an auxiliary video media URL to play in the case were the `mediaUrl` URL cannot be played.
  This may be used to provide a fallback for the case where DASH media cannot be played due to a lack of MSE support.
* `offset`: optional numeric time offset in seconds by which the video playback current time is greater than the component timeline clock,
  when synced as either a master or slave.
  If not specified this is the same as startMediaTime.
  This may be a string in mm:ss or hh:mm:ss format.
* `startMediaTime`: optional numeric time in seconds to seek the video at initialisation, this is not useful when `syncMode` is `slave`.
  This may be a string in mm:ss or hh:mm:ss format.
* `syncMode`: optional string of the sync mode of this component.
  Possible values:
  * `slave`: This component is slaved to its component reference clock. **This is the default**.
  * `master`: This component is the master of its component reference clock.
  * `none`: This component is not synced.
* `showControls`: optional boolean or string whether to show controls on the video element. If not set, the default is false. The string value "auto" enables controls if the media is in master mode.
* `muted`: optional boolean whether to mute audio. If not set, the default is false.
* `emptyMediaUrlOk`: optional boolean whether to suppress warnings about the `mediaUrl` parameter being empty/missing. If not set, the default is false.
* `preserveMediaTime`: optional boolean whether to preserve media time when switching media, not relevant when running in slave mode. If not set, the default is false.
* `atomicSwitch`: optional boolean whether media switches should be done in an atomic way by overlapping playback of the old and new media streams. If not set, the default is device-dependendant (false if the device looks like an Odroid, true otherwise).
* `atomicSwitchTimeout`: optional numeric time in milliseconds, upper limit of how long to wait for an atomic media switch to complete. If not set, the default is 3000 ms.
* `atomicSwitchDelay`: optional numeric time in milliseconds, how long to wait after the new media stream becomes ready before executing the atomic switch. If not set, the default is 0 ms.
* `posterImage`: optional URL of a video tag poster image
* `errorPosterImage`: optional URL of an error state video tag poster image
* `readyImmediately`: optional boolean whether to signal readiness immediately, without waiting for video to be playable. If not set, the default is false.
* `noAutoPlay`: optional boolean whether to disable autoplay. If not set, the default is false.
* `volumeSignal`: optional string name of a signal to control the volume level. The signal must have a value in the range [0, 1].
* `audioChildren`: optional array of parameter objects for child audio player components.
* `avoidNegativeClockStep`: optional boolean whether to try to avoid negative step changes in the clock value when initialising media playback. If not set, the default is true.
* `useBandwidthOrchestration`: optional boolean whether to use bandwidth orchestration service.
* `bandwidthOrchestrationSandPlayerOptions`: optional object of bandwidth orchestration DASH.js SAND player options.
* `selfDestructOnMediaEnd`: optional boolean whether to self destruct when end of media is reached.
* `alwaysLoadAfterTime`: optional expression string which returns a time relative to the component's reference clock after which media is always loaded (even when the component is soft-stopped), this is intended for pre-fetch operations before a component is un-soft-stopped.
* `limitBitrateByPortalSize`: optional boolean whether to limit ABR bitrate by portal size. If not set, the default is true.
* `initialVideoBandwidth`: optional numeric bandwidth in kbps used to select the initial video representation at playback start. This is not required to be finite.
* `mediaMinimumSyncTimePreOffset`: optional numeric time in seconds by which the clock to which the media is synced in slave mode is clamped to be greater than or equal to the given value (relative to the component timeline clock).
* `mediaMinimumSyncTimePostOffset`: optional numeric time in seconds by which the clock to which the media is synced in slave mode is clamped to be greater than or equal to the given value (relative to the component timeline clock, after the offset parameter is applied).
* `initialCanPlayNetworkSlowTimeout`: optional numeric time in milliseconds, how long to wait for media to be playable at playback init, before considering the network to be slow. If not set, the default is 6000 ms.
* `seekCompletionNetworkSlowTimeout`: optional numeric time in milliseconds, how long to wait for media to be playable after a seek operation, before considering the network to be slow. If not set, the default is 3000 ms.
* `sendApp2AppMsgOnMediaEnd`: optional object describing app2app message to send when end of media is reached, see [sendApp2AppMsg](../jsdoc/DMAppComponent.html#sendApp2AppMsg).
  * `sendApp2AppMsgOnMediaEnd.toDeviceId`: string device ID to send message to.
  * `sendApp2AppMsgOnMediaEnd.toComponentId`: string component ID to send message to.
  * `sendApp2AppMsgOnMediaEnd.msgBody`: optional message body to send.
* `sendApp2AppMsgBeforeMediaEnd`: optional object describing app2app message to send before the end of media is reached, see [sendApp2AppMsg](../jsdoc/DMAppComponent.html#sendApp2AppMsg).
  * `sendApp2AppMsgBeforeMediaEnd.offset`: numeric approximate time in seconds before the predicted end of the media to send the message.
  * `sendApp2AppMsgBeforeMediaEnd.toDeviceId`: string device ID to send message to.
  * `sendApp2AppMsgBeforeMediaEnd.toComponentId`: string component ID to send message to.
  * `sendApp2AppMsgBeforeMediaEnd.msgBody`: optional message body to send.
* `acquireNamedRefCountSignalWhilstUnpresentable`: optional string type-prefixed signal name of a reference counter type signal, (passed to [getSignalByName](../jsdoc/DMAppController.html#getSignalByName)). This signal is acquired whilst the component is not currently in a presentable state. Changes to this parameter whilst the component is already in an unpresentable state do not take immediate effect.
* `pauseOnSyncStop`: optional boolean whether to pause the media element when sync is stopped due to the clock being unavailable, only relevant when running in slave mode. If not set, the default is false.

Default parameters may be set by using the local signal named: media-player-component-default-parameters

Special values for `mediaUrl` and `auxMediaUrl` parameters:
* "webcam://" uses the local webcam input source.
  This may be suffixed with query parameters: `audio` and `video` with values: true or false, to enable audio and video capture respectively. For example: "webcam://?audio=false".
  To set constraints on the stream, query parameters whose names are given by the concatenation of one entry from each of the following two lists may also be set.
  aspectRatio, frameRate, height, width.
  Min, Max, Exact, Ideal.
  See [the documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints) for more details.

### Audio component

This has a 'class' field of 'audio'.

This has the same parameters and behaviour as the video component, above.

### Debug component ID text display component

This has a 'class' field of 'text'.

No parameters are defined.


## Universal parameters

Parameters which begin with two leading underscores `__` are universal parameters which are handled by the client-api on behalf of the component.

Available universal parameters:
* `__notRunnableBeforeTime`: optional expression string which returns a time relative to the component's reference clock before which the component shall not be runnable (it is soft-stopped)
* `__writeTimingSignal`: optional string name of a signal into which component timing values (relative to the component's reference clock) are written. This is an object with properties: startTime, stopTime, durationEstimate, estimatedEndTime.
* `__elementClass`: optional string of comma-separated CSS class name(s) to apply to the component's element.
* `__componentTimelineClockSource`: optional string of component timeline clock source clock name.
* `__acquireApp2AppCallbackName`: optional string of an app2app named callback name (%-prefixed) to acquire.
* `__acquireRefCountSignalOnPresentable`: optional string of a ref-count type prefixed signal name to acquire when the component becomes presentable.
* `__acquireRefCountSignalOnReallyPresentable`: optional string of a ref-count type prefixed signal name to acquire when the component becomes really presentable.
* `__softStopOnSignal`: optional string of a prefixed signal name which when high/truthy the component shall not be runnable (it is soft-stopped).

See [setExpressionSignal](../jsdoc/DMAppController.html#setExpressionSignal) and [expr-eval](https://www.npmjs.com/package/expr-eval) for details of expression strings.

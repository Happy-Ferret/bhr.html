/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { rebuildDateGraph, setWorkerInformation } from './actions';
/**
 * Messages are the translation layer from actions dispatched by the content
 * thread to the worker thread. This de-couples the state of the two threads.
 * In the worker this is the only place that actions can be dispatched.
 */
const messages = {};
export default messages;

messages.REBUILD_DATE_GRAPH = function(message, call) {
  call(rebuildDateGraph, message.thread, message.selectedStack);
};

messages.SET_WORKER_INFORMATION = function(message, call) {
  call(setWorkerInformation, message.workerIndex, message.numWorkers);
}

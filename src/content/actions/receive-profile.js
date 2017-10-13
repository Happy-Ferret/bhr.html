// @flow
import type {
  Action,
  ThunkAction,
} from './types';
import type { Profile } from '../../common/types/profile';
import { UniqueStringArray } from '../unique-string-array';
import { OneToManyIndex } from '../one-to-many-index';
import { selectedThreadSelectors } from '../reducers/profile-view';

export function waitingForProfileFromTelemetry(durationSpec: string, historical: boolean): Action {
  return {
    type: 'WAITING_FOR_PROFILE_FROM_TELEMETRY',
    durationSpec,
    historical,
  };
}

export function receiveProfileFromTelemetry(profile: Profile): ThunkAction {
  return (dispatch, getState) => {
    dispatch({
      type: 'RECEIVE_PROFILE_FROM_TELEMETRY',
      profile,
    });

    dispatch({
      toSummaryWorker: true,
      type: 'PROFILE_PROCESSED',
      profile: profile,
    });

    dispatch({
      toSummaryWorker: true,
      type: 'SUMMARIZE_PROFILE',
    });

    dispatch({
      type: 'REBUILD_DATE_GRAPH',
      toDateGraphWorker: true,
      thread: selectedThreadSelectors.getFilteredThread(getState()),
      selectedStack: selectedThreadSelectors.getSelectedStack(getState()),
    });
  };
}

export function errorReceivingProfileFromTelemetry(error: any): Action {
  return {
    type: 'ERROR_RECEIVING_PROFILE_FROM_TELEMETRY',
    error,
  };
}

export function retrieveProfileFromTelemetry(durationSpec: string,
                                             payloadID: string,
                                             historical: boolean): ThunkAction {
  return async dispatch => {
    dispatch(waitingForProfileFromTelemetry(durationSpec, historical));

    function getProfileURL(thread: string | null = null) {
      let fileRoot = `hang_profile_${durationSpec}`;

      if (historical) {
        fileRoot += '_historical';
      }

      if (thread) {
        fileRoot += '_' + thread;
      }

      if (payloadID) {
        fileRoot += '_' + payloadID;
      }

      return `https://analysis-output.telemetry.mozilla.org/bhr/data/hang_aggregates/${fileRoot}.json`;
    }

    const profileURL = getProfileURL();

    try {
      const res = await fetch(profileURL);
      let profile = await res.json();
      if (profile.isSplit) {
        let threads = await Promise.all(profile.threads.map(t => fetch(getProfileURL(t)).then(r => r.json())));
        profile.usageHoursByDate = threads[0].usageHoursByDate;
        profile.uuid = threads[0].uuid;
        profile.threads = threads.map(t => t.threads[0]);
      }

      function union(setA, setB) {
          let union = new Set();
          for (let elem of setA) {
            union.add(elem);
          }
          for (let elem of setB) {
            union.add(elem);
          }
          return union;
      }

      let allDates;
      if (profile.threads.length !== 0) {
        let dateSets = profile.threads.map(t => new Set(t.dates.map(d => d.date)));
        allDates = dateSets[0];
        dateSets.slice(1).forEach(ds => {
          allDates = union(allDates, ds);
        });
      } else {
        allDates = new Set();
      }

      for (let thread of profile.threads) {
        {
          let prefix = new Int32Array(thread.stackTable.length);
          let func = new Int32Array(thread.stackTable.length);
          let depth = new Int32Array(thread.stackTable.length);
          for (let i = 0; i < thread.stackTable.length; i++) {
            if (thread.stackTable.prefix[i] === null) {
              prefix[i] = -1;
              depth[i] = 0;
            } else {
              prefix[i] = thread.stackTable.prefix[i];
              depth[i] = 1 + depth[prefix[i]];
            }
            func[i] = thread.stackTable.func[i];
          }

          Object.assign(thread.stackTable, {
            prefix,
            func,
            depth,
          });
        }

        thread.sampleTable.sampleHangMs = new Float32Array(thread.sampleTable.length);
        thread.sampleTable.sampleHangCount = new Float32Array(thread.sampleTable.length);

        thread.dates = Array.from(allDates).map(date => {
          let threadDate = thread.dates.find(d => d.date === date);

          if (threadDate) {
            let sampleHangMs = new Float32Array(thread.sampleTable.length);
            let sampleHangCount = new Float32Array(thread.sampleTable.length);
            sampleHangMs.set(threadDate.sampleHangMs);
            sampleHangCount.set(threadDate.sampleHangCount);

            for (let i = 0; i < thread.sampleTable.length; i++) {
              thread.sampleTable.sampleHangMs[i] += sampleHangMs[i];
              thread.sampleTable.sampleHangCount[i] += sampleHangCount[i];
            }

            return Object.assign({}, threadDate, {date, sampleHangMs, sampleHangCount});
          } else {
            return  {
              length: thread.sampleTable.length,
              sampleHangMs: new Float32Array(thread.sampleTable.length),
              sampleHangCount: new Float32Array(thread.sampleTable.length),
              date,
            };
          }
        });

        thread.dates.sort((lhs, rhs) => lhs.date - rhs.date);
        thread.stringTable = new UniqueStringArray(thread.stringArray);
      }

      if (profile.threads.length !== 0) {
        profile.dates = profile.threads[0].dates.map(d => d.date);
      } else {
        profile.dates = [];
      }

      dispatch(receiveProfileFromTelemetry(profile));
    } catch (error) {
      dispatch(errorReceivingProfileFromTelemetry(error));
    }
  };
}

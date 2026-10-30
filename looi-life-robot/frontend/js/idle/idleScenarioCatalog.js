export const IDLE_SCENARIO_GLOBAL_DEFAULTS=Object.freeze({speedScale:1,durationScale:1,rampMs:50,angularSign:1});
export const IDLE_SCENARIO_TYPES=Object.freeze({BODY:'body'});
export const IDLE_SCENARIO_AVAILABILITY=Object.freeze({ALWAYS:'always',CONVERSATION_ACTIVE:'conversation_active',CONVERSATION_INACTIVE:'conversation_inactive'});
export function sanitizeIdleScenarios(items=[]){return items.map(s=>({...s,animationType:'body',effectiveAnimationType:'body',usesMovement:true,allowOppositeMix:false,steps:(s.steps??[]).filter(x=>['move','stop','pause'].includes(x.kind))})).filter(s=>s.steps.some(x=>x.kind==='move'));}
export const IDLE_SCENARIOS=Object.freeze(sanitizeIdleScenarios([
  {
    "id": "idle_shift_right_back_left_front_copy",
    "title": "Soft Left Forward Twist (extended)",
    "description": "Soft left-forward twist with a longer wheel sequence.",
    "pairWith": "idle_shift_right_back_left_front_copy_copy",
    "availability": "conversation_inactive",
    "animationType": "body",
    "effectiveAnimationType": "body",
    "usesMovement": true,
    "allowOppositeMix": false,
    "steps": [
      {
        "kind": "move",
        "left": 0.3,
        "right": -0.5,
        "durationMs": 300,
        "pauseMs": 350
      },
      {
        "kind": "move",
        "left": -0.3,
        "right": 0.5,
        "durationMs": 300,
        "pauseMs": 120
      }
    ]
  },
  {
    "id": "idle_shift_right_back_left_front_copy_copy",
    "title": "Soft Right Forward Twist (extended)",
    "description": "Soft right-forward twist with a longer wheel sequence.",
    "pairWith": "idle_shift_right_back_left_front_copy",
    "availability": "conversation_inactive",
    "animationType": "body",
    "effectiveAnimationType": "body",
    "usesMovement": true,
    "allowOppositeMix": false,
    "steps": [
      {
        "kind": "move",
        "left": -0.5,
        "right": 0.3,
        "durationMs": 300,
        "pauseMs": 350
      },
      {
        "kind": "move",
        "left": 0.5,
        "right": -0.3,
        "durationMs": 300,
        "pauseMs": 120
      }
    ]
  },
  {
    "id": "idle_shift_right_back_left_front",
    "title": "Soft Left Forward Twist",
    "description": "Left wheel forward, right wheel backward stronger. Balanced by Soft Right Forward Twist.",
    "pairWith": "idle_shift_right_front_left_back",
    "availability": "always",
    "animationType": "body",
    "effectiveAnimationType": "body",
    "usesMovement": true,
    "allowOppositeMix": false,
    "steps": [
      {
        "kind": "move",
        "left": 0.3,
        "right": -0.5,
        "durationMs": 125,
        "pauseMs": 70
      },
      {
        "kind": "stop",
        "left": 0,
        "right": 0,
        "durationMs": 0,
        "pauseMs": 120
      }
    ]
  },
  {
    "id": "idle_shift_right_front_left_back",
    "title": "Soft Right Forward Twist",
    "description": "Left wheel backward stronger, right wheel forward. Balanced by Soft Left Forward Twist.",
    "pairWith": "idle_shift_right_back_left_front",
    "availability": "always",
    "animationType": "body",
    "effectiveAnimationType": "body",
    "usesMovement": true,
    "allowOppositeMix": false,
    "steps": [
      {
        "kind": "move",
        "left": -0.5,
        "right": 0.3,
        "durationMs": 125,
        "pauseMs": 70
      },
      {
        "kind": "stop",
        "left": 0,
        "right": 0,
        "durationMs": 0,
        "pauseMs": 120
      }
    ]
  },
  {
    "id": "idle_both_front_left_soft",
    "title": "Tiny Left Forward Pivot",
    "description": "Left wheel forward and right wheel backward with equal strength.",
    "pairWith": "idle_custom_6",
    "availability": "always",
    "animationType": "body",
    "effectiveAnimationType": "body",
    "usesMovement": true,
    "allowOppositeMix": false,
    "steps": [
      {
        "kind": "move",
        "left": 0.5,
        "right": -0.5,
        "durationMs": 80,
        "pauseMs": 90
      },
      {
        "kind": "stop",
        "left": 0,
        "right": 0,
        "durationMs": 0,
        "pauseMs": 120
      }
    ]
  },
  {
    "id": "idle_custom_6",
    "title": "Tiny Right Forward Pivot",
    "description": "Left wheel backward and right wheel forward with equal strength.",
    "pairWith": "idle_both_front_left_soft",
    "availability": "always",
    "animationType": "body",
    "effectiveAnimationType": "body",
    "usesMovement": true,
    "allowOppositeMix": false,
    "steps": [
      {
        "kind": "move",
        "left": -0.5,
        "right": 0.5,
        "durationMs": 80,
        "pauseMs": 90
      },
      {
        "kind": "stop",
        "left": 0,
        "right": 0,
        "durationMs": 0,
        "pauseMs": 120
      }
    ]
  },
  {
    "id": "idle_both_front_tiny",
    "title": "Tiny Forward Pulse",
    "description": "Both wheels forward for a short alive nudge.",
    "pairWith": "idle_custom_7",
    "availability": "always",
    "animationType": "body",
    "effectiveAnimationType": "body",
    "usesMovement": true,
    "allowOppositeMix": false,
    "steps": [
      {
        "kind": "move",
        "left": 0.5,
        "right": 0.5,
        "durationMs": 80,
        "pauseMs": 90
      },
      {
        "kind": "stop",
        "left": 0,
        "right": 0,
        "durationMs": 0,
        "pauseMs": 120
      }
    ]
  },
  {
    "id": "idle_custom_7",
    "title": "Tiny Backward Pulse",
    "description": "Both wheels backward for a short balancing nudge.",
    "pairWith": "idle_both_front_tiny",
    "availability": "always",
    "animationType": "body",
    "effectiveAnimationType": "body",
    "usesMovement": true,
    "allowOppositeMix": false,
    "steps": [
      {
        "kind": "move",
        "left": -0.5,
        "right": -0.5,
        "durationMs": 80,
        "pauseMs": 90
      },
      {
        "kind": "stop",
        "left": 0,
        "right": 0,
        "durationMs": 0,
        "pauseMs": 120
      }
    ]
  },
  {
    "id": "idle_forward_then_backward",
    "title": "Tiny Forward Back",
    "description": "Forward pulse, then backward pulse.",
    "pairWith": "",
    "availability": "always",
    "animationType": "body",
    "effectiveAnimationType": "body",
    "usesMovement": true,
    "allowOppositeMix": false,
    "steps": [
      {
        "kind": "move",
        "left": 0.5,
        "right": 0.5,
        "durationMs": 80,
        "pauseMs": 175
      },
      {
        "kind": "move",
        "left": -0.5,
        "right": -0.5,
        "durationMs": 80,
        "pauseMs": 175
      }
    ]
  },
  {
    "id": "idle_custom_8",
    "title": "Tiny Forward Back Slow",
    "description": "Forward/backward pulse with a longer forward pause.",
    "pairWith": "",
    "availability": "always",
    "animationType": "body",
    "effectiveAnimationType": "body",
    "usesMovement": true,
    "allowOppositeMix": false,
    "steps": [
      {
        "kind": "move",
        "left": 0.5,
        "right": 0.5,
        "durationMs": 80,
        "pauseMs": 250
      },
      {
        "kind": "move",
        "left": -0.5,
        "right": -0.5,
        "durationMs": 80,
        "pauseMs": 120
      }
    ]
  },
  {
    "id": "multi_forward_back",
    "title": "Multi Forward Back",
    "description": "Forward Back, Forward Back Slow, then Forward Back again.",
    "pairWith": "",
    "availability": "always",
    "animationType": "body",
    "effectiveAnimationType": "body",
    "usesMovement": true,
    "allowOppositeMix": false,
    "steps": [
      {
        "kind": "move",
        "left": 0.5,
        "right": 0.5,
        "durationMs": 80,
        "pauseMs": 175
      },
      {
        "kind": "move",
        "left": -0.5,
        "right": -0.5,
        "durationMs": 80,
        "pauseMs": 175
      },
      {
        "kind": "move",
        "left": 0.5,
        "right": 0.5,
        "durationMs": 80,
        "pauseMs": 250
      },
      {
        "kind": "move",
        "left": -0.5,
        "right": -0.5,
        "durationMs": 80,
        "pauseMs": 120
      },
      {
        "kind": "move",
        "left": 0.5,
        "right": 0.5,
        "durationMs": 80,
        "pauseMs": 175
      },
      {
        "kind": "move",
        "left": -0.5,
        "right": -0.5,
        "durationMs": 80,
        "pauseMs": 175
      }
    ]
  }
]));
export const IDLE_SCENARIO_ORDER=Object.freeze(IDLE_SCENARIOS.map(s=>s.id));
export function cloneIdleScenarios(){return structuredClone(IDLE_SCENARIOS);}
export function getIdleScenarioById(id){return IDLE_SCENARIOS.find(s=>s.id===id)??null;}
export function normalizeIdleScenarioType(){return 'body';}
export function getIdleScenarioChannels(s={}){return {animationType:'body',effectiveAnimationType:'body',usesMovement:(s.steps??[]).some(x=>x.kind==='move'),allowOppositeMix:false};}
export function normalizeIdleScenarioAvailability(v){return Object.values(IDLE_SCENARIO_AVAILABILITY).includes(v)?v:'always';}

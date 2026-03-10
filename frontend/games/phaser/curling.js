registerGame("curling", "🥌 Curling", "Click to aim, hold for power", "Get closest to the bullseye!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#c8dce8");
    this.add.rectangle(W/2,H/2,W,H,0xd8ecf8);
    this.add.circle(600,H/2,80).setStrokeStyle(3,0xe94560);
    this.add.circle(600,H/2,50).setStrokeStyle(3,0x4466cc);
    this.add.circle(600,H/2,20,0xe94560);
    this.stones=this.physics.add.group();
    this.turn=0;this.totalThrows=0;this.maxThrows=8;
    this.physics.add.collider(this.stones,this.stones);
    this.msgTxt=this.add.text(W/2,20,(this.turn===0?"P1":"P2")+"'s throw — click & hold to aim",{fontSize:"16px",color:"#333",fontFamily:"monospace"}).setOrigin(0.5);
    this.aiming=false;this.power=0;
    this.input.on("pointerdown",()=>{this.aiming=true;this.power=0;});
    this.input.on("pointerup",(ptr)=>{
      if(!this.aiming||this.totalThrows>=this.maxThrows)return;this.aiming=false;
      const s=this.add.circle(80,H/2+(this.turn===0?-20:20),14,this.turn===0?0xf7c948:0xe94560);
      this.stones.add(s);this.physics.add.existing(s);s.body.setBounce(0.5).setDrag(60).setCollideWorldBounds(true);
      const angle=Phaser.Math.Angle.Between(80,H/2,ptr.x,ptr.y);
      s.body.setVelocity(Math.cos(angle)*this.power*3,Math.sin(angle)*this.power*3);
      s.setData("team",this.turn);this.turn=1-this.turn;this.totalThrows++;
      this.msgTxt.setText(this.totalThrows>=this.maxThrows?"DONE!":(this.turn===0?"P1":"P2")+"'s throw");
      if(this.totalThrows>=this.maxThrows)this.time.delayedCall(2000,()=>this.scoreGame());
    });
  }
  scoreGame(){
    let best1=999,best2=999;const tx=600,ty=H/2;
    this.stones.getChildren().forEach(s=>{const d=Phaser.Math.Distance.Between(s.x,s.y,tx,ty);if(s.getData("team")===0)best1=Math.min(best1,d);else best2=Math.min(best2,d);});
    this.add.text(W/2,H/2,(best1<best2?"P1":"P2")+" WINS! (closest to center)",{fontSize:"28px",color:"#333",fontFamily:"monospace"}).setOrigin(0.5);
  }
  update(){if(this.aiming)this.power=Math.min(this.power+1,150);}
});

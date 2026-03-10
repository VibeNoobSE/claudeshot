registerGame("bumper-cars", "🚗 Bumper Cars", "WASD = P1, Arrows = P2", "Smash into each other — most hits wins!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#2a2a1e");
    this.add.ellipse(W/2,H/2,700,420).setStrokeStyle(3,0x666633);
    this.p1=this.add.rectangle(W/3,H/2,30,20,0xf7c948);this.p2=this.add.rectangle(W*2/3,H/2,30,20,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setBounce(1.2).setDrag(100).setMaxVelocity(350);p.setData("hits",0);p.setData("angle",0);});
    this.physics.add.collider(this.p1,this.p2,()=>{
      const v1=this.p1.body.speed,v2=this.p2.body.speed;
      if(v1>v2+30){this.p1.setData("hits",this.p1.getData("hits")+1);}
      else if(v2>v1+30){this.p2.setData("hits",this.p2.getData("hits")+1);}
      this.sTxt.setText("P1: "+this.p1.getData("hits")+" hits | P2: "+this.p2.getData("hits")+" hits");
    });
    this.sTxt=this.add.text(W/2,20,"P1: 0 hits | P2: 0 hits",{fontSize:"18px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
    this.timeLeft=25;
    this.timeTxt=this.add.text(W/2,H-20,this.timeLeft+"s",{fontSize:"16px",color:"#888",fontFamily:"monospace"}).setOrigin(0.5);
    this.time.addEvent({delay:1000,callback:()=>{if(--this.timeLeft<=0){this.physics.pause();const w=this.p1.getData("hits")>=this.p2.getData("hits")?"P1":"P2";this.add.text(W/2,H/2,w+" WINS!",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}this.timeTxt.setText(this.timeLeft+"s");},loop:true});
  }
  update(){const s=500,k=this.k;
    if(k.a.isDown)this.p1.body.setAccelerationX(-s);else if(k.d.isDown)this.p1.body.setAccelerationX(s);else this.p1.body.setAccelerationX(0);
    if(k.w.isDown)this.p1.body.setAccelerationY(-s);else if(k.s.isDown)this.p1.body.setAccelerationY(s);else this.p1.body.setAccelerationY(0);
    if(k.left.isDown)this.p2.body.setAccelerationX(-s);else if(k.right.isDown)this.p2.body.setAccelerationX(s);else this.p2.body.setAccelerationX(0);
    if(k.up.isDown)this.p2.body.setAccelerationY(-s);else if(k.down.isDown)this.p2.body.setAccelerationY(s);else this.p2.body.setAccelerationY(0);
  }
});
